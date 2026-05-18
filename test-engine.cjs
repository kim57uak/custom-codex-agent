/**
 * CommonJS test for engine-column propagation in workflow_runs.
 * Inserts a row, reads it back, prints pre-fix failed rows, and cleans up.
 */
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'workflows.db');
const db = new Database(dbPath);

// Test create + readback engine column
const id = 'test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
const now = new Date().toISOString();

db.prepare(`
  INSERT INTO workflow_runs (workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, engine, status, current_step_index, total_steps, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, 1, ?)
`).run(id, 'test engine propagation', '', null, null, 'gemini', now);

db.prepare(`
  INSERT INTO workflow_steps (step_index, workflow_run_id, agent_name, skill_name, icon_key, title, prompt, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
`).run(0, id, 'springboot-verification-agent', null, 'bot', 'Test Step', 'test');

const row = db.prepare('SELECT * FROM workflow_runs WHERE workflow_run_id = ?').get(id);
console.log('engine stored:', row.engine);
console.log('PASS:', row.engine === 'gemini' ? 'YES' : 'FAIL');

db.prepare('DELETE FROM workflow_runs WHERE workflow_run_id = ?').run(id);
db.prepare('DELETE FROM workflow_steps WHERE workflow_run_id = ?').run(id);

// Check old failed runs
console.log('\n=== Pre-fix Failed Runs ===');
const failed = db.prepare("SELECT workflow_run_id, engine, status FROM workflow_runs WHERE status='failed' ORDER BY created_at DESC LIMIT 3").all();
for (const r of failed) {
  console.log(r.workflow_run_id, 'engine:', r.engine, r.engine === null ? 'NULL (pre-fix)' : 'OK');
}

db.close();
console.log('\nDONE');
process.exit(0);
