import fs from 'fs';
import path from 'path';
import os from 'os';
import { SETTINGS } from '../settings/AppSettings';
import { ConfigReader } from './ConfigReader';

export interface InspectorFileModel {
  name: string;
  path: string;
  kind: string;
  sizeBytes: number;
  modifiedAt: string | null;
  content: string;
  truncated: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: string | null;
}

export interface InspectorResponse {
  agentName: string;
  roleLabelKo: string;
  departmentLabelKo: string;
  description: string;
  shortDescription: string | null;
  oneClickPrompt: string | null;
  skillName: string | null;
  skillPath: string | null;
  agentTomlPath: string | null;
  agentJsonPath: string | null;
  skillMarkdown: InspectorFileModel | null;
  agentToml: InspectorFileModel | null;
  agentJson: InspectorFileModel | null;
  references: InspectorFileModel[];
  scripts: InspectorFileModel[];
  assets: InspectorFileModel[];
}

export class InspectorService {
  private configReader: ConfigReader;

  constructor() {
    this.configReader = new ConfigReader();
  }

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

  private _safeReadText(filePath: string): string {
    try {
      return fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch {
      return '';
    }
  }

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
