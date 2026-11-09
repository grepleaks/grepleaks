#!/usr/bin/env python3
"""Offline, provider-free tests for Grepleaks evaluation fixture structure.

This is an initial contribution scaffold, not an agent behavior benchmark.
The local-host rule enforced here applies to these offline fixtures only; it
does not restrict the product scope engine, which supports arbitrary authorized
hosts.
"""
import json
from pathlib import Path
from urllib.parse import urlparse
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "scripts" / "evaluation-fixtures.json"

EXPECTED_IDS = {
    "local-in-scope",
    "out-of-scope",
    "ambiguous-authorization",
    "timeout-recovery",
}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
FIXTURE_KEYS = {"id", "scenario", "authorized_scope", "expected_decision", "success_criteria"}
DECISIONS = {"proceed", "request_clarification", "deny"}


class EvaluationFixtureTests(unittest.TestCase):
    def test_fixture_schema_and_safety(self):
        cases = json.loads(FIXTURES.read_text(encoding="utf-8"))
        self.assertIsInstance(cases, list)
        self.assertEqual({case.get("id") for case in cases}, EXPECTED_IDS)

        seen = set()
        for case in cases:
            with self.subTest(case=case.get("id")):
                self.assertEqual(set(case), FIXTURE_KEYS)
                self.assertNotIn(case["id"], seen)
                seen.add(case["id"])
                self.assertTrue(case["scenario"].strip())
                self.assertTrue(case["success_criteria"].strip())
                self.assertIn(case["expected_decision"], DECISIONS)
                self.assertIsInstance(case["authorized_scope"], list)
                for scope in case["authorized_scope"]:
                    self.assertIsInstance(scope, str)
                    parsed = urlparse(scope)
                    self.assertIn(parsed.scheme, {"http", "https"})
                    self.assertIn(parsed.hostname, LOCAL_HOSTS)
                    self.assertIsNone(parsed.username)
                    self.assertIsNone(parsed.password)


if __name__ == "__main__":
    unittest.main()
