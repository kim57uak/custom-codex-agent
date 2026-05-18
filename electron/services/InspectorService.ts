/**
 * InspectorService — 에이전트 디렉토리/파일 검사 서비스.
 *
 * @what
 * - 특정 에이전트의 설정(config.json / agent.toml), 스킬 마크다운, 참조 파일, 스크립트,
 *   에셋을 조회하고 내용을 읽어 InspectorResponse로 반환합니다.
 * - 디렉토리 목록 조회, 파일 저장, 경로 보안 검증 기능을 제공합니다.
 *
 * @design
 * - ConfigReader를 통해 에이전트 메타데이터를 읽고, 파일 경로를 동적으로 탐색합니다.
 * - _isWithinRoot()로 허용된 홈 디렉토리 범위를 벗어난 접근을 차단합니다.
 * - 파일 내용은 SETTINGS.safeReadTextMaxChars로 잘라서 반환합니다.
 *
 * @usage
 *   const inspector = new InspectorService();
 *   const info = inspector.loadAgentInspector('my-agent', 'gemini');
 *   const entries = inspector.listDirectory('/path/to/agents');
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SETTINGS } from '../settings/AppSettings';
import { ConfigReader } from './ConfigReader';

/** 검사기에서 반환되는 파일 모델. 파일 메타데이터와 내용을 함께 포함합니다. */
export interface InspectorFileModel {
  /** 파일명 */
  name: string;
  /** 파일 절대 경로 */
  path: string;
  /** 파일 종류 (skill-md, agent-toml, agent-json, reference, script, asset 등) */
  kind: string;
  /** 파일 크기 (바이트) */
  sizeBytes: number;
  /** 최종 수정 시간 (ISO-8601) */
  modifiedAt: string | null;
  /** 파일 내용 텍스트 (최대 safeReadTextMaxChars) */
  content: string;
  /** 내용이 잘렸는지 여부 */
  truncated: boolean;
}

/** 디렉토리 목록의 단일 엔트리를 나타냅니다. */
export interface FileEntry {
  /** 파일/디렉토리 이름 */
  name: string;
  /** 파일/디렉토리 절대 경로 */
  path: string;
  /** 파일 또는 디렉토리 구분 */
  kind: 'file' | 'directory';
  /** 파일 크기 (디렉토리는 0) */
  sizeBytes: number;
  /** 최종 수정 시간 (ISO-8601) */
  modifiedAt: string | null;
}

/**
 * 에이전트 검사기 응답. 에이전트 메타정보와 연관된 모든 파일을 포함합니다.
 */
export interface InspectorResponse {
  /** 에이전트 이름 */
  agentName: string;
  /** 역할 라벨 (한글) */
  roleLabelKo: string;
  /** 부서 라벨 (한글) */
  departmentLabelKo: string;
  /** 에이전트 설명 */
  description: string;
  /** 짧은 설명 (80자 제한) */
  shortDescription: string | null;
  /** 원클릭 프롬프트 */
  oneClickPrompt: string | null;
  /** 연결된 스킬 이름 */
  skillName: string | null;
  /** 연결된 스킬 파일 경로 */
  skillPath: string | null;
  /** agent.toml 파일 경로 */
  agentTomlPath: string | null;
  /** config.json 파일 경로 */
  agentJsonPath: string | null;
  /** 스킬 마크다운 파일 모델 */
  skillMarkdown: InspectorFileModel | null;
  /** agent.toml 파일 모델 */
  agentToml: InspectorFileModel | null;
  /** config.json 파일 모델 */
  agentJson: InspectorFileModel | null;
  /** 참조 파일 목록 */
  references: InspectorFileModel[];
  /** 스크립트 파일 목록 */
  scripts: InspectorFileModel[];
  /** 에셋 파일 목록 */
  assets: InspectorFileModel[];
}

export class InspectorService {
  /** 파일 및 에이전트 메타데이터 읽기를 위한 ConfigReader */
  private configReader: ConfigReader;

  /**
   * InspectorService 인스턴스를 생성합니다.
   * 내부적으로 ConfigReader를 초기화합니다.
   */
  constructor() {
    this.configReader = new ConfigReader();
  }

  /**
   * 지정된 에이전트의 전체 검사 정보를 로드합니다.
   * config.json / agent.toml, 스킬 파일, 참조/스크립트/에셋을 모두 수집합니다.
   * @param agentName - 검사할 에이전트 이름
   * @param engine - 엔진 이름 (선택)
   * @returns 검사 응답, 에이전트를 찾을 수 없으면 null
   */
  loadAgentInspector(agentName: string, engine?: string): InspectorResponse | null {
    try {
      let agentsRaw = this.configReader.readAgents(engine);
      let agent = agentsRaw.find((a: Record<string, unknown>) => String(a.name) === agentName);

      // Not found on disk — fall back to config.json agents
      if (!agent) {
        const configAgents = this.configReader.listAgents();
        const configAgent = configAgents.find(a => a.name === agentName);
        if (configAgent) {
          return {
            agentName: configAgent.name,
            roleLabelKo: SETTINGS.founderName,
            departmentLabelKo: configAgent.department || '관리지원',
            description: configAgent.description || '',
            shortDescription: null,
            oneClickPrompt: null,
            skillName: null,
            skillPath: null,
            agentTomlPath: null,
            agentJsonPath: null,
            skillMarkdown: null,
            agentToml: null,
            agentJson: null,
            references: [],
            scripts: [],
            assets: [],
          };
        }
        return null;
      }

      const skillPathValue = agent.skill_path ? String(agent.skill_path) : null;
      const paths = this._getInspectorPaths(agentName, skillPathValue, engine);

      const files: Record<string, InspectorFileModel | InspectorFileModel[]> = {
        references: [],
        scripts: [],
        assets: [],
      };

      for (const [filePath, kind] of Object.entries(paths)) {
        const model = this._buildFileModel(filePath, kind);
        if (kind === 'agent-toml') { files.agentToml = model as InspectorFileModel; }
        else if (kind === 'agent-json') { files.agentJson = model as InspectorFileModel; }
        else if (kind === 'skill-md') { files.skillMarkdown = model as InspectorFileModel; }
        else if (kind === 'reference') { (files.references as InspectorFileModel[]).push(model as InspectorFileModel); }
        else if (kind === 'script') { (files.scripts as InspectorFileModel[]).push(model as InspectorFileModel); }
        else if (kind === 'asset') { (files.assets as InspectorFileModel[]).push(model as InspectorFileModel); }
      }

      return {
        agentName: String(agent.name || agentName),
        roleLabelKo: String(agent.role_label || SETTINGS.founderName),
        departmentLabelKo: String(agent.department || '관리지원'),
        description: String(agent.description || ''),
        shortDescription: agent.short_description ? String(agent.short_description) : null,
        oneClickPrompt: agent.one_click_prompt ? String(agent.one_click_prompt) : null,
        skillName: agent.skill_name ? String(agent.skill_name) : null,
        skillPath: skillPathValue,
        agentTomlPath: paths['agent-toml'] ? String(Object.keys(paths).find(k => paths[k] === 'agent-toml') ?? null) : null,
        agentJsonPath: paths['agent-json'] ? String(Object.keys(paths).find(k => paths[k] === 'agent-json') ?? null) : null,
        agentToml: (files.agentToml as InspectorFileModel) ?? null,
        agentJson: (files.agentJson as InspectorFileModel) ?? null,
        skillMarkdown: (files.skillMarkdown as InspectorFileModel) ?? null,
        references: files.references as InspectorFileModel[],
        scripts: files.scripts as InspectorFileModel[],
        assets: files.assets as InspectorFileModel[],
      };
    } catch (err) {
      console.error(`[InspectorService] loadAgentInspector("${agentName}") failed:`, err);
      return null;
    }
  }

  /**
   * 지정된 디렉토리의 파일/폴더 목록을 반환합니다. 심볼릭 링크 순회를 방지합니다.
   * @param dirPath - 조회할 디렉토리 경로
   * @param engine - 엔진 이름 (선택, 경로 검증용)
   * @returns FileEntry 배열 (이름순 정렬)
   */
  listDirectory(dirPath: string, engine?: string): FileEntry[] {
    try {
      const resolved = path.resolve(dirPath);
      if (!this._isWithinRoot(resolved, engine)) {
        return [];
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return [];
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const result: FileEntry[] = [];
      for (const entry of entries) {
        try {
          const fullPath = path.join(resolved, entry.name);
          const realPath = fs.realpathSync(fullPath);
          if (!realPath.startsWith(resolved)) {
            continue;
          }
          const stat = fs.statSync(fullPath);
          result.push({
            name: entry.name,
            path: fullPath,
            kind: entry.isDirectory() ? 'directory' : 'file',
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          continue;
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /**
   * 에이전트에 연결된 스킬 파일 경로를 조회합니다.
   * 기본 SKILL.md와 동일 디렉토리의 SKILL.md/AGENT.md 파일을 모두 포함합니다.
   * @param agentName - 에이전트 이름
   * @param engine - 엔진 이름 (선택)
   * @returns 스킬 파일 경로 배열 (중복 제거, 정렬)
   */
  resolveSkills(agentName: string, engine?: string): string[] {
    try {
      const agentsRaw = this.configReader.readAgents(engine);
      const agent = agentsRaw.find((a: Record<string, unknown>) => String(a.name) === agentName);
      if (!agent) return [];
      const skillPathValue = agent.skill_path ? String(agent.skill_path) : null;
      if (!skillPathValue) return [];
      const skillPath = path.resolve(skillPathValue.replace(/^~/, os.homedir()));
      if (!fs.existsSync(skillPath)) return [];
      const paths: string[] = [skillPath];
      const skillDir = path.dirname(skillPath);
      if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
        for (const entry of fs.readdirSync(skillDir)) {
          if (entry.toLowerCase() === 'skILL.md' || entry.toLowerCase() === 'agent.md') {
            const candidate = path.join(skillDir, entry);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              paths.push(candidate);
            }
          }
        }
      }
      return [...new Set(paths)].sort();
    } catch {
      return [];
    }
  }

  /**
   * 지정된 경로의 파일 내용을 저장(덮어쓰기)합니다.
   * JSON 파일일 경우 내용 유효성을 먼저 검증합니다.
   * @param filePathStr - 저장할 파일 경로
   * @param content - 저장할 내용
   * @param engine - 엔진 이름 (선택, 경로 검증용)
   * @returns 업데이트된 파일 모델, 실패 시 null
   */
  saveFile(filePathStr: string, content: string, engine?: string): InspectorFileModel | null {
    try {
      const resolved = path.resolve(filePathStr);
      if (!this._isWithinRoot(resolved, engine)) return null;
      if (!fs.existsSync(resolved)) return null;
      if (filePathStr.endsWith('.json')) {
        try { JSON.parse(content); } catch { throw new Error('Invalid JSON content'); }
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return this._buildFileModel(resolved, '');
    } catch {
      return null;
    }
  }

  /**
   * 에이전트 디렉토리와 스킬 참조 경로를 탐색하여 검사 대상 파일 경로 맵을 구성합니다.
   * @param agentName - 에이전트 이름
   * @param skillPathValue - 스킬 파일 경로 (null 가능)
   * @param engine - 엔진 이름 (선택, 경로 검증용)
   * @returns 파일 경로를 키로, 종류를 값으로 하는 맵
   */
  private _getInspectorPaths(agentName: string, skillPathValue: string | null, engine?: string): Record<string, string> {
    const paths: Record<string, string> = {};
    const agentsRoot = SETTINGS.getAgentsRoot(engine);
    const agentDir = path.join(agentsRoot, agentName);

    const addFile = (p: string, kind: string) => {
      if (fs.existsSync(p) && fs.statSync(p).isFile() && this._isWithinRoot(p, engine)) {
        paths[p] = kind;
      }
    };

    addFile(path.join(agentDir, 'agent.toml'), 'agent-toml');
    addFile(path.join(agentDir, 'config.json'), 'agent-json');

    if (skillPathValue) {
      const skillPath = path.resolve(skillPathValue.replace(/^~/, os.homedir()));
      addFile(skillPath, 'skill-md');

      const skillDir = path.dirname(skillPath);
      if (fs.existsSync(skillDir) && this._isWithinRoot(skillDir, engine)) {
        for (const subDir of ['references', 'scripts', 'assets']) {
          const subPath = path.join(skillDir, subDir);
          if (!fs.existsSync(subPath) || !fs.statSync(subPath).isDirectory()) continue;
          const kind = subDir === 'references' ? 'reference' : subDir === 'scripts' ? 'script' : 'asset';
          const entries = fs.readdirSync(subPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of entries) {
            const fullPath = path.join(subPath, entry.name);
            if (entry.isFile()) {
              addFile(fullPath, kind);
            } else if (entry.isDirectory()) {
              const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
              for (const se of subEntries) {
                if (se.isFile()) addFile(path.join(fullPath, se.name), kind);
              }
            }
          }
        }
      }
    }

    return paths;
  }

  /**
   * 파일 경로에서 메타데이터와 내용을 읽어 InspectorFileModel을 생성합니다.
   * 내용은 safeReadTextMaxChars를 초과하면 잘립니다.
   * @param filePath - 읽을 파일 경로
   * @param kind - 파일 종류
   * @returns 구성된 파일 모델
   */
  private _buildFileModel(filePath: string, kind: string): InspectorFileModel {
    const content = this._safeReadText(filePath);
    const truncated = content.length > SETTINGS.safeReadTextMaxChars;
    const displayContent = truncated ? content.slice(0, SETTINGS.safeReadTextMaxChars) : content;
    try {
      const stat = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        kind,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content: displayContent,
        truncated,
      };
    } catch {
      return {
        name: path.basename(filePath),
        path: filePath,
        kind,
        sizeBytes: 0,
        modifiedAt: null,
        content: displayContent,
        truncated,
      };
    }
  }

  /**
   * 파일을 UTF-8 텍스트로 안전하게 읽습니다. 실패 시 빈 문자열을 반환합니다.
   * @param filePath - 읽을 파일 경로
   * @returns 파일 내용 문자열
   */
  private _safeReadText(filePath: string): string {
    try {
      return fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch {
      return '';
    }
  }

  /**
   * 대상 경로가 허용된 루트 범위 내에 있는지 확인합니다.
   * 엔진 홈 디렉토리, 사용자 홈 디렉토리, ~/.claude를 허용합니다.
   * @param targetPath - 검증할 대상 경로
   * @param engine - 엔진 이름 (선택)
   * @returns 허용된 경로이면 true
   */
  private _isWithinRoot(targetPath: string, engine?: string): boolean {
    const resolved = path.resolve(targetPath);
    const home = SETTINGS.getHome(engine);
    const homeResolved = path.resolve(home);
    if (resolved.startsWith(homeResolved)) return true;
    const allowed = [
      os.homedir(),
      path.join(os.homedir(), '.claude'),
    ];
    for (const root of allowed) {
      if (resolved.startsWith(path.resolve(root))) return true;
    }
    return false;
  }
}
