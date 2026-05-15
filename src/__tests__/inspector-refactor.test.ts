import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { InspectorService } from '../../electron/services/InspectorService';
import type { AgentConfig, AgentInspectorResponse, AgentInspectorFileModel } from '../../types/ipc-contract';

const VIEWS_DIR = path.resolve(__dirname, '../components/views');
const STORE_FILE = path.resolve(__dirname, '../stores/inspectorStore.ts');
const CSS_FILE = path.resolve(__dirname, '../styles/global.css');
const HANDLER_FILE = path.resolve(__dirname, '../../electron/ipc/handlers.ts');

describe('Inspector Refactor — 전체 검증', () => {

  describe('1. InspectorService — 파일 스캔 & 저장', () => {
    let service: InspectorService;
    let tmpDir: string;
    let agentDir: string;

    beforeEach(() => {
      service = new InspectorService();
      tmpDir = path.join(os.homedir(), '.inspector-test-' + Date.now());
      agentDir = path.join(tmpDir, 'test-agent');
      fs.mkdirSync(agentDir, { recursive: true });
    });

    it('loadAgentInspector — 존재하지 않는 에이전트는 null 반환', () => {
      const result = service.loadAgentInspector('nonexistent-agent-xyz');
      expect(result).toBeNull();
    });

    it('saveFile — 홈 디렉토리 내 파일의 내용을 덮어쓴다', () => {
      const filePath = path.join(agentDir, 'agent.toml');
      fs.writeFileSync(filePath, 'original');
      const saved = service.saveFile(filePath, 'updated content');
      expect(saved).not.toBeNull();
      expect(saved!.name).toBe('agent.toml');
      expect(saved!.content).toBe('updated content');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('updated content');
    });

    it('saveFile — 존재하지 않는 파일이면 null 반환', () => {
      const fakePath = path.join(agentDir, 'nonexistent.md');
      const result = service.saveFile(fakePath, 'nope');
      expect(result).toBeNull();
    });

    it('saveFile — JSON 파일에 유효하지 않은 내용은 저장하지 않는다', () => {
      const filePath = path.join(agentDir, 'config.json');
      fs.writeFileSync(filePath, '{}');
      const result = service.saveFile(filePath, '{invalid json!!!');
      expect(result).toBeNull();
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{}');
    });

    it('saveFile — JSON 파일에 유효한 JSON은 정상 저장된다', () => {
      const filePath = path.join(agentDir, 'config.json');
      fs.writeFileSync(filePath, '{}');
      const result = service.saveFile(filePath, '{"updated":true}');
      expect(result).not.toBeNull();
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"updated":true}');
    });

    afterAll(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });
  });

  describe('2. IPC 핸들러 — inspector:load-agent & inspector:save-file', () => {
    it('inspector:load-agent 핸들러가 존재한다', () => {
      const source = fs.readFileSync(HANDLER_FILE, 'utf-8');
      expect(source).toContain("'inspector:load-agent'");
    });

    it('inspector:save-file 핸들러가 존재한다', () => {
      const source = fs.readFileSync(HANDLER_FILE, 'utf-8');
      expect(source).toContain("'inspector:save-file'");
    });

    it('load-agent 핸들러가 agentName을 필수로 검증한다', () => {
      const source = fs.readFileSync(HANDLER_FILE, 'utf-8');
      const loadHandler = source.split("'inspector:load-agent'")[1]?.split('ipcMain.handle')[0] ?? '';
      expect(source).toMatch(/agentName.*required|typeof p\.agentName/);
    });

    it('save-file 핸들러가 path와 content를 필수로 검증한다', () => {
      const source = fs.readFileSync(HANDLER_FILE, 'utf-8');
      const saveSection = source.split("'inspector:save-file'")[1]?.slice(0, 600) ?? '';
      expect(saveSection).toMatch(/path and content required|typeof p\.path.*typeof p\.content/);
    });
  });

  describe('3. IPC Contract — AgentInspectorResponseSchema', () => {
    it('AgentInspectorResponseSchema에 assets 필드가 있다', async () => {
      const { AgentInspectorResponseSchema } = await import('../../types/ipc-contract');
      const shape = AgentInspectorResponseSchema.shape;
      expect(shape.assets).toBeDefined();
    });

    it('AgentInspectorFileSchema에 필수 필드가 모두 있다', async () => {
      const { AgentInspectorFileSchema } = await import('../../types/ipc-contract');
      const shape = AgentInspectorFileSchema.shape;
      expect(shape.name).toBeDefined();
      expect(shape.path).toBeDefined();
      expect(shape.kind).toBeDefined();
      expect(shape.sizeBytes).toBeDefined();
      expect(shape.content).toBeDefined();
    });

    it('AgentInspectorResponseSchema에 핵심 필드가 모두 있다', async () => {
      const { AgentInspectorResponseSchema } = await import('../../types/ipc-contract');
      const shape = AgentInspectorResponseSchema.shape;
      expect(shape.agentName).toBeDefined();
      expect(shape.roleLabelKo).toBeDefined();
      expect(shape.departmentLabelKo).toBeDefined();
      expect(shape.description).toBeDefined();
      expect(shape.skillMarkdown).toBeDefined();
      expect(shape.agentToml).toBeDefined();
      expect(shape.agentJson).toBeDefined();
      expect(shape.references).toBeDefined();
      expect(shape.scripts).toBeDefined();
      expect(shape.assets).toBeDefined();
    });

    it('AgentInspectorResponseSchema로 유효한 데이터를 파싱할 수 있다', async () => {
      const { AgentInspectorResponseSchema } = await import('../../types/ipc-contract');
      const fileModel = {
        name: 'agent.toml',
        path: '/test/agent.toml',
        kind: 'agent-toml',
        sizeBytes: 100,
        modifiedAt: '2025-01-01T00:00:00.000Z',
        content: 'name = "test"',
        truncated: false,
      };
      const data = {
        agentName: 'test-agent',
        roleLabelKo: '테스트',
        departmentLabelKo: '개발',
        description: '테스트 에이전트',
        shortDescription: null,
        oneClickPrompt: null,
        skillName: null,
        skillPath: null,
        agentTomlPath: null,
        agentJsonPath: null,
        skillMarkdown: fileModel,
        agentToml: fileModel,
        agentJson: null,
        references: [],
        scripts: [],
        assets: [],
      };
      const result = AgentInspectorResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('4. InspectorView 컴포넌트 — 소스 코드 검증', () => {
    let source: string;
    beforeEach(() => {
      source = fs.readFileSync(path.join(VIEWS_DIR, 'InspectorView.tsx'), 'utf-8');
    });

    it('handleSelectAgent에서 setLoading/setError를 호출한다', () => {
      expect(source).toContain('setLoading(true)');
      expect(source).toContain('setLoading(false)');
      expect(source).toContain("setError('에이전트 정보를 불러올 수 없습니다.')");
    });

    it('loading 상태에서 스피너를 보여준다', () => {
      expect(source).toMatch(/loading\s*&&/);
      expect(source).toContain('className="spinner"');
      expect(source).toContain('에이전트 정보를 불러오는 중');
    });

    it('error 상태에서 오류 메시지를 보여준다', () => {
      expect(source).toMatch(/error\s*&&\s*!response/);
      expect(source).toContain('오류');
    });

    it('fileMap이 response에서 올바르게 구성된다', () => {
      expect(source).toContain('useMemo');
      expect(source).toContain('fileMap');
      expect(source).toContain('response.agentToml');
      expect(source).toContain('response.agentJson');
      expect(source).toContain('response.skillMarkdown');
      expect(source).toContain('response.references');
      expect(source).toContain('response.scripts');
      expect(source).toContain('response.assets');
    });

    it('handleSelectFile이 fileMap에서 콘텐츠를 조회한다 (IPC 재호출 없음)', () => {
      expect(source).toContain('fileMap.get(filePath)');
      expect(source).toContain('setEditContent(file.content)');
      expect(source).toContain('setOriginalContent(file.content)');
    });

    it('inspector-main__split 그리드 레이아웃이 있다', () => {
      expect(source).toContain('inspector-main__split');
      expect(source).toContain('InspectorFileBrowser');
      expect(source).toContain('inspector-main__editor-area');
    });

    it('저장 관련 상태 관리가 있다', () => {
      expect(source).toContain('handleSave');
      expect(source).toContain('inspector:save-file');
      expect(source).toContain('setOriginalContent(editContent)');
      expect(source).toContain('저장됨');
      expect(source).toContain('저장 실패');
    });

    it('되돌리기(Revert) 기능이 있다', () => {
      expect(source).toContain('handleRevert');
      expect(source).toContain('되돌리기');
      expect(source).toContain('setEditContent(originalContent)');
    });

    it('에셋(assets) 파일 그룹이 렌더링된다', () => {
      expect(source).toContain('response.assets');
      expect(source).toContain('에셋');
    });

    it('코리안어 UI 텍스트가 적용되어 있다', () => {
      const koreanTexts = [
        '인스펙터',
        '에이전트',
        '스킬',
        '검색',
        '저장',
        '되돌리기',
        '스킬 파일',
        '설정',
        '참조 문서',
        '스크립트',
      ];
      for (const text of koreanTexts) {
        expect(source).toContain(text);
      }
    });

    it('FileEditor가 file 객체를 받아 렌더링한다', () => {
      expect(source).toContain('const FileEditor: React.FC');
      expect(source).toContain('inspector-file-editor__textarea');
      expect(source).toContain('onContentChange');
      expect(source).toContain('onSave');
    });

    it('FileEditor에서 truncated 파일 경고가 한국어로 표시된다', () => {
      expect(source).toContain('파일이 너무 큽니다');
    });
  });

  describe('5. inspectorStore — 상태 관리', () => {
    it('loading 초기값은 false다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      const state = store.getState();
      expect(state.loading).toBe(false);
    });

    it('error 초기값은 null이다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      const state = store.getState();
      expect(state.error).toBeNull();
    });

    it('resetSelection이 selectedFile 관련 상태를 초기화한다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      store.setState({ selectedFile: '/test/path', selectedFileContent: 'hi', selectedFileOriginal: 'hi' });
      store.getState().resetSelection();
      const state = store.getState();
      expect(state.selectedFile).toBeNull();
      expect(state.selectedFileContent).toBeNull();
      expect(state.selectedFileOriginal).toBeNull();
    });

    it('setResponse가 파일 선택 상태도 초기화한다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      store.setState({ selectedFile: '/test', selectedFileContent: 'x', selectedFileOriginal: 'x' });
      store.getState().setResponse({ agentName: 'a' } as any);
      const state = store.getState();
      expect(state.selectedFile).toBeNull();
      expect(state.selectedFileContent).toBeNull();
      expect(state.selectedFileOriginal).toBeNull();
    });

    it('setLoading이 loading 상태를 변경한다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      store.getState().setLoading(true);
      expect(store.getState().loading).toBe(true);
      store.getState().setLoading(false);
      expect(store.getState().loading).toBe(false);
    });

    it('setError가 error 상태를 변경한다', async () => {
      const mod = await import('../stores/inspectorStore');
      const store = mod.useInspectorStore;
      store.getState().setError('test error');
      expect(store.getState().error).toBe('test error');
      store.getState().setError(null);
      expect(store.getState().error).toBeNull();
    });
  });

  describe('6. CSS 레이아웃 — inspector-main', () => {
    it('.inspector-main이 height:100% 대신 flex:1을 사용한다', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf-8');
      const inspectorMain = css.match(/\.inspector-main\s*\{[^}]+\}/s);
      expect(inspectorMain).not.toBeNull();
      expect(inspectorMain![0]).toContain('flex: 1');
      expect(inspectorMain![0]).toContain('min-height: 0');
      expect(inspectorMain![0]).not.toContain('height: 100%');
    });

    it('.inspector-view에 flex:1과 min-height:0이 있다', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf-8');
      const inspectorView = css.match(/\.inspector-view\s*\{[^}]+\}/s);
      expect(inspectorView).not.toBeNull();
      expect(inspectorView![0]).toContain('flex: 1');
      expect(inspectorView![0]).toContain('min-height: 0');
    });

    it('.inspector-main__split 그리드 레이아웃이 있다', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf-8');
      const splitMatch = css.match(/\.inspector-main__split\s*\{[^}]+\}/s);
      expect(splitMatch).not.toBeNull();
      expect(splitMatch![0]).toContain('grid-template-columns');
    });

    it('.inspector-file-browser가 overflow 처리된다', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf-8');
      const browserMatch = css.match(/\.inspector-file-browser\s*\{[^}]+\}/s);
      expect(browserMatch).not.toBeNull();
      expect(browserMatch![0]).toContain('overflow');
    });

    it('.inspector-file-editor가 flex 레이아웃을 가진다', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf-8');
      const editorMatch = css.match(/\.inspector-file-editor\s*\{[^}]+\}/s);
      expect(editorMatch).not.toBeNull();
      expect(editorMatch![0]).toContain('display: flex');
    });
  });

  describe('7. InspectorService — assets 스캔', () => {
    it('_getInspectorPaths가 assets 서브디렉토리를 포함한다', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../electron/services/InspectorService.ts'),
        'utf-8'
      );
      expect(source).toContain("'references', 'scripts', 'assets'");
      expect(source).toContain("'asset'");
    });

    it('InspectorResponse 인터페이스에 assets가 있다', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../electron/services/InspectorService.ts'),
        'utf-8'
      );
      expect(source).toMatch(/assets:\s*InspectorFileModel\[\]/);
    });
  });
});