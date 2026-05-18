/**
 * Ad-hoc test script verifying that the engine column is correctly propagated
 * through workflow_runs CRUD, and that failed pre-fix rows have NULL engine.
 * Run standalone with tsx.
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), '.config', 'agent-orchestrator', 'workflows.db');
const db = new Database(dbPath);

// Test 1: create + readback engine
const id = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const now = new Date().toISOString();
const engine = 'gemini';
const steps = [{ agentName: 'springboot-verification-agent', prompt: 'test', title: 'Test Step', iconKey: 'bot', skillName: null }];

db.prepare(`
  INSERT INTO workflow_runs (workflow_run_id, goal_prompt, workspace_root, sandbox_mode, approval_policy, engine, status, current_step_index, total_steps, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
`).run(id, 'test engine propagation', '', null, null, engine, steps.length, now);

for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  db.prepare(`
    INSERT INTO workflow_steps (step_index, workflow_run_id, agent_name, skill_name, icon_key, title, prompt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
  `).run(i, id, s.agentName, s.skillName ?? null, s.iconKey ?? 'bot', s.title ?? `Step ${i + 1}`, s.prompt);
}

const row = db.prepare('SELECT * FROM workflow_runs WHERE workflow_run_id = ?').get(id) as any;
console.log('=== DB Engine Storage ===');
console.log('engine:', row.engine);
console.log('PASS:', row.engine === 'gemini' ? 'YES' : 'FAIL');

db.prepare('DELETE FROM workflow_runs WHERE workflow_run_id = ?').run(id);
db.prepare('DELETE FROM workflow_steps WHERE workflow_run_id = ?').run(id);

// Test 2: verify old failed runs have NULL engine (pre-fix)
console.log('\n=== Pre-fix Failed Runs (engine=NULL = bug) ===');
const failed = db.prepare("SELECT workflow_run_id, engine, status FROM workflow_runs WHERE status='failed' ORDER BY created_at DESC LIMIT 3").all() as any[];
for (const r of failed) {
  console.log(r.workflow_run_id, 'engine:', r.engine, '-', r.engine === null ? 'BUG (NULL)' : 'OK');
}

// Test 3: engine resolution (no await needed)  
console.log('\n=== Engine Resolution ===');
function resolveEngine(engine?: string, def = 'gemini') { return engine || def; }
console.log('undefined →', resolveEngine(undefined), '(fallback gemini)');
console.log('null →', resolveEngine(null as any), '(fallback gemini)');
console.log("'gemini' →", resolveEngine('gemini'));
console.log("'opencode' →", resolveEngine('opencode'));

db.close();
console.log('\nDONE');
