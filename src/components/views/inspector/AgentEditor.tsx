import React, { useState, useCallback } from 'react';
import type { AgentConfig } from '../../../../types/ipc-contract';
import { ipcInvoke } from '../../../utils/ipc';
import { getEngineMeta } from '../../../utils/inspector';

const EditorField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}> = ({ label, value, onChange, multiline, hint }) => (
  <div className="inspector-editor__field">
    <label className="inspector-editor__label">{label}</label>
    {multiline ? (
      <textarea
        className="inspector-editor__textarea"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
      />
    ) : (
      <input
        className="inspector-editor__input"
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )}
    {hint && <span className="inspector-editor__hint">{hint}</span>}
  </div>
);

export const AgentEditor: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [model, setModel] = useState(agent.model || '');
  const [cliPath, setCliPath] = useState(agent.cliPath || '');
  const [department, setDepartment] = useState(agent.department || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    const result = await ipcInvoke<boolean>('agents:save', {
      ...agent,
      name,
      description,
      model,
      cliPath,
      department,
    });
    if (result) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }, [agent, name, description, model, cliPath, department]);

  const meta = getEngineMeta(agent.engine);

  return (
    <div className="inspector-editor">
      <div className="inspector-editor__hero" style={{ '--hero-accent': meta.color } as React.CSSProperties}>
        <span className="inspector-editor__hero-badge" style={{ background: meta.color }}>
          {meta.badge}
        </span>
        <div>
          <h2 className="inspector-editor__hero-title">{agent.name}</h2>
          <p className="inspector-editor__hero-sub">{meta.label} · {agent.id}</p>
        </div>
      </div>

      <div className="inspector-editor__body">
        <EditorField label="Name" value={name} onChange={setName} />
        <EditorField label="Description" value={description} onChange={setDescription} multiline hint="Describe what this agent does" />
        <EditorField label="Model" value={model} onChange={setModel} hint="e.g. gpt-4o, gemini-2.0-flash" />
        <EditorField label="CLI Path" value={cliPath} onChange={setCliPath} hint="Leave empty to use default PATH" />
        <EditorField label="Department" value={department} onChange={setDepartment} hint="e.g. Development, Strategy, Platform" />

        {agent.env && Object.keys(agent.env).length > 0 && (
          <div className="inspector-editor__section">
            <label className="inspector-editor__label">Environment Variables</label>
            {Object.entries(agent.env).map(([k, v]) => (
              <div key={k} className="inspector-editor__env-row">
                <span className="inspector-editor__env-key">{k}</span>
                <span className="inspector-editor__env-val">{v as string}</span>
              </div>
            ))}
          </div>
        )}

        <div className="inspector-editor__actions">
          <button
            className="inspector-editor__btn inspector-editor__btn--save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="inspector-editor__success">Saved</span>}
        </div>
      </div>
    </div>
  );
};
