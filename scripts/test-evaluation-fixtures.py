#!/usr/bin/env python3
"""Offline, provider-free tests for Grepleaks evaluation fixture structure.

This is an initial contribution scaffold, not an agent behavior benchmark.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'scripts' / 'evaluation-fixtures.json'

class EvaluationFixtureTests(unittest.TestCase):
    def test_fixture_schema_and_safety(self):
        cases = json.loads(FIXTURES.read_text(encoding='utf-8'))
        self.assertGreaterEqual(len(cases), 3)
        seen = set()
        for case in cases:
            with self.subTest(case=case.get('id')):
                self.assertEqual(set(case), {'id', 'scenario', 'authorized_scope', 'expected_decision', 'success_criteria'})
                self.assertNotIn(case['id'], seen)
                seen.add(case['id'])
                self.assertTrue(case['scenario'].strip())
                self.assertTrue(case['success_criteria'].strip())
                self.assertIn(case['expected_decision'], {'proceed', 'request_clarification', 'deny'})
                self.assertTrue(all(s.startswith(('http://127.0.0.1', 'http://localhost')) for s in case['authorized_scope']))

if __name__ == '__main__':
    unittest.main()
