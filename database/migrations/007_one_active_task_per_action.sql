CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_per_action
  ON tasks(user_id, action_id)
  WHERE status IN ('pending', 'in_progress');
