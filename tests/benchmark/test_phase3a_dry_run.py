import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / 'tools' / 'benchmark' / 'phase3a_dry_run.py'
SPEC = importlib.util.spec_from_file_location('phase3a_dry_run', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Phase3ADryRunTest(unittest.TestCase):
    def test_deidentification_redacts_direct_identifiers_and_preserves_action_text(self):
        value, replacements = MODULE.deidentify_text('姓名：虚构张三 学号：SYNTH-001 手机号：13800138000 邮箱 fake@example.test。请提交材料。')
        self.assertGreaterEqual(replacements, 4)
        self.assertNotIn('13800138000', value)
        self.assertNotIn('fake@example.test', value)
        self.assertIn('请提交材料', value)

    def test_state_machine_rejects_illegal_transition(self):
        machine = MODULE.DatasetStateMachine()
        with self.assertRaises(ValueError):
            machine.transition('gold')

    def test_state_machine_requires_full_ordered_path(self):
        machine = MODULE.DatasetStateMachine()
        for state in MODULE.STATES[1:]:
            machine.transition(state)
        self.assertEqual(machine.state, 'frozen')
        self.assertEqual(machine.history, list(MODULE.STATES))


if __name__ == '__main__':
    unittest.main()
