/**
 * EngineSettingsPanel - 엔진별 설정 패널
 *
 * 기능:
 * - 엔진 CLI 경로 설정
 * - 모델/프롭시/타임아웃 설정
 * - 연결 검증 (CLI --version 실행)
 * - 엔진별 환경 변수 설정
 *
 * Phase 5 완료 항목:
 * - [x] Engine별 설정 페이지
 */

import React, { useState, useCallback } from 'react';
import { ipcInvoke } from '../../utils/ipc';

/** 엔진 설정 타입 */
interface EngineSettings {
  cliPath: string;
  model: string;
  timeout: number;
  proxy: string;
  extraEnv: Record<string, string>;
}

/** 엔진별 기본 설정 */
const DEFAULT_SETTINGS: Record<string, EngineSettings> = {
  gemini: {
    cliPath: '/usr/local/bin/gemini',
    model: 'gemini-2.0-flash',
    timeout: 30000,
    proxy: '',
    extraEnv: {},
  },
  opencode: {
    cliPath: '/usr/local/bin/opencode',
    model: 'default',
    timeout: 30000,
    proxy: '',
    extraEnv: {},
  },
  claudecode: {
    cliPath: '/usr/local/bin/claude',
    model: 'claude-sonnet-4-20250514',
    timeout: 60000,
    proxy: '',
    extraEnv: {},
  },
};

/** 엔진별 설명 */
const ENGINE_DESCRIPTIONS: Record<string, { name: string; description: string; icon: string }> = {
  gemini: {
    name: 'Google Gemini',
    description: 'Google Gemini CLI - Gemini 2.0 Flash 기반 어시스턴트',
    icon: 'sparkles',
  },
  opencode: {
    name: 'OpenCode',
    description: 'OpenCode CLI - 오픈소스 코딩 어시스턴트',
    icon: 'code',
  },
  claudecode: {
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI - Claude Sonnet 4 기반 코딩 어시스턴트',
    icon: 'comment-discussion',
  },
};

/** 엔진 타입 */
type EngineType = 'gemini' | 'opencode' | 'claudecode';

interface EngineSettingsPanelProps {
  initialEngine?: EngineType;
}

/**
 * EngineSettingsPanel - 엔진별 설정 패널
 * CLI 경로, 모델, 타임아웃, 프록시 설정
 */
/**
 * EngineSettingsPanel — 엔진별 설정 패널.
 * CLI 경로, 모델, 타임아웃, 프록시 설정 및 연결 검증 제공.
 * @param props - 컴포넌트 Props
 * @returns 엔진 설정 패널 JSX 요소
 */
export const EngineSettingsPanel: React.FC<EngineSettingsPanelProps> = ({ initialEngine = 'gemini' }) => {
  const [selectedEngine, setSelectedEngine] = useState<EngineType>(initialEngine);
  const [settings, setSettings] = useState<Record<string, EngineSettings>>({ ...DEFAULT_SETTINGS });
  const [validationStatus, setValidationStatus] = useState<Record<string, { valid: boolean; version?: string; error?: string } | null>>({});
  const [isValidating, setIsValidating] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  /** 설정 변경 핸들러 */
  const updateSetting = useCallback((engine: string, key: keyof EngineSettings, value: string | number | Record<string, string>) => {
setSettings(prev => {
      const current: EngineSettings = prev[engine]!;
      const updated: EngineSettings = {
        ...current,
        [key]: value,
      } as EngineSettings;
      return {
        ...prev,
        [engine]: updated,
      };
    });
  }, []);

  /** CLI 연결 검증 */
  const validateEngine = useCallback(async (engine: string) => {
    setIsValidating(prev => ({ ...prev, [engine]: true }));
    setValidationStatus(prev => ({ ...prev, [engine]: null }));

    const result = await ipcInvoke<{ valid: boolean; version?: string; error?: string }>('cli:validate', settings[engine]?.cliPath);
    setValidationStatus(prev => ({ ...prev, [engine]: result }));
    setIsValidating(prev => ({ ...prev, [engine]: false }));
  }, [settings]);

  /** 설정 저장 */
  const saveSettings = useCallback(async () => {
    setIsSaving(true);

    // 각 엔진 설정을 저장
    for (const [engine, engineSettings] of Object.entries(settings)) {
      await ipcInvoke('agents:save', {
        id: `engine-${engine}`,
        name: ENGINE_DESCRIPTIONS[engine]?.name ?? engine,
        engine,
        cliPath: engineSettings.cliPath,
        model: engineSettings.model,
        env: {
          ...engineSettings.extraEnv,
          ...(engineSettings.proxy ? { HTTPS_PROXY: engineSettings.proxy } : {}),
          ...(engineSettings.timeout ? { CLI_TIMEOUT: String(engineSettings.timeout) } : {}),
        },
      });
    }

    setIsSaving(false);
  }, [settings]);

  const currentDesc = ENGINE_DESCRIPTIONS[selectedEngine]!;
  const currentSettings = settings[selectedEngine]!;
  const currentValidation = validationStatus[selectedEngine];

  return (
    <div className="engine-settings-panel">
      {/* 엔진 선택 탭 */}
      <div className="engine-settings-panel__tabs">
        {(Object.keys(ENGINE_DESCRIPTIONS) as EngineType[]).map((engine) => (
          <button
            key={engine}
            className={`engine-settings-panel__tab ${selectedEngine === engine ? 'engine-settings-panel__tab--active' : ''}`}
            onClick={() => setSelectedEngine(engine)}
          >
            <span className={`codicon codicon-${ENGINE_DESCRIPTIONS[engine]!.icon}`} />
            <span>{ENGINE_DESCRIPTIONS[engine]!.name}</span>
          </button>
        ))}
      </div>

      {/* 엔진 설명 */}
      <div className="engine-settings-panel__description">
        <span className={`codicon codicon-${currentDesc.icon}`} style={{ fontSize: '24px' }} />
        <div>
          <h3>{currentDesc.name}</h3>
          <p>{currentDesc.description}</p>
        </div>
      </div>

      {/* 설정 폼 */}
      <div className="engine-settings-panel__form">
        <div className="engine-settings-panel__field">
          <label htmlFor="cli-path">CLI Path</label>
          <input
            id="cli-path"
            type="text"
            value={currentSettings.cliPath}
            onChange={(e) => updateSetting(selectedEngine, 'cliPath', e.target.value)}
            placeholder="/usr/local/bin/gemini"
          />
          <button
            className="engine-settings-panel__validate"
            disabled={isValidating[selectedEngine]}
            onClick={() => validateEngine(selectedEngine)}
          >
            {isValidating[selectedEngine] ? 'Validating...' : 'Validate'}
          </button>
        </div>

        {/* 검증 결과 */}
        {currentValidation && (
          <div className={`engine-settings-panel__validation ${currentValidation.valid ? 'engine-settings-panel__validation--valid' : 'engine-settings-panel__validation--invalid'}`}>
            {currentValidation.valid ? (
              <span><span className="codicon codicon-check" /> CLI found: {currentValidation.version}</span>
            ) : (
              <span><span className="codicon codicon-error" /> {currentValidation.error}</span>
            )}
          </div>
        )}

        <div className="engine-settings-panel__field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={currentSettings.model}
            onChange={(e) => updateSetting(selectedEngine, 'model', e.target.value)}
            placeholder="gpt-4o"
          />
        </div>

        <div className="engine-settings-panel__field">
          <label htmlFor="timeout">Timeout (ms)</label>
          <input
            id="timeout"
            type="number"
            value={currentSettings.timeout}
            onChange={(e) => updateSetting(selectedEngine, 'timeout', parseInt(e.target.value, 10) || 30000)}
            min={1000}
            max={300000}
          />
        </div>

        <div className="engine-settings-panel__field">
          <label htmlFor="proxy">HTTPS Proxy</label>
          <input
            id="proxy"
            type="text"
            value={currentSettings.proxy}
            onChange={(e) => updateSetting(selectedEngine, 'proxy', e.target.value)}
            placeholder="http://proxy:8080 (optional)"
          />
        </div>
      </div>

      {/* 저장 버튼 */}
      <div className="engine-settings-panel__actions">
        <button className="engine-settings-panel__save" disabled={isSaving} onClick={saveSettings}>
          {isSaving ? 'Saving...' : 'Save All Settings'}
        </button>
        <button className="engine-settings-panel__reset" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};

export default EngineSettingsPanel;