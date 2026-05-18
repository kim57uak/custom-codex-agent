/**
 * InspectorFileBrowser — 인스펙터에서 선택된 에이전트의 파일 목록 브라우저.
 *
 * 기능:
 * - AgentInspectorResponse 데이터를 그룹화하여 파일 목록 표시
 * - 그룹: 설정(config), Skill Definition, 참조 문서, 스크립트, 에셋
 * - 각 파일 카드: 파일명, 종류 아이콘, 크기, 언어 표시
 * - 클릭 시 FileEditor로 전달할 파일 선택
 *
 * Props:
 * - response (AgentInspectorResponse): 로드된 에이전트 정보
 * - selectedFile: 현재 선택된 파일 경로
 * - onSelectFile: 파일 선택 콜백
 *
 * 앱 내 배치:
 * - InspectorView 메인 영역 좌측 패널 하단
 * - InspectorSidebar에서 에이전트 선택 시 response 데이터 기반 렌더링
 */
import React from 'react';
import type { AgentInspectorFileModel, AgentInspectorResponse } from '../../../../types/ipc-contract';
import { detectLanguage, formatBytes, getKindIcon, getFileIcon, FILE_KIND_LABELS } from '../../../utils/inspector';

/**
 * FileCard — 개별 파일 카드 컴포넌트.
 * @returns 파일 카드 JSX 요소
 */
const FileCard: React.FC<{
  file: AgentInspectorFileModel;
  selected: boolean;
  onClick: () => void;
}> = ({ file, selected, onClick }) => (
  <div
    className={`inspector-file-card ${selected ? 'active' : ''}`}
    onClick={onClick}
  >
    <div className="inspector-file-card__icon">
      <span className="inspector-file-card__emoji">{getKindIcon(file.kind)}</span>
    </div>
    <div className="inspector-file-card__info">
      <span className="inspector-file-card__name">{file.name}</span>
      <span className="inspector-file-card__meta">
        {FILE_KIND_LABELS[file.kind] || file.kind} · {formatBytes(file.sizeBytes)}
      </span>
    </div>
    <div className="inspector-file-card__lang">{detectLanguage(file.name)}</div>
  </div>
);

/**
 * FileGroup — 파일 그룹(설정/Skill Definition/참조 등) 컴포넌트.
 * @returns 파일 그룹 JSX 요소
 */
const FileGroup: React.FC<{
  title: string;
  icon: string;
  files: AgentInspectorFileModel[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}> = ({ title, icon, files, selectedFile, onSelect }) => {
  if (!files || files.length === 0) return null;
  return (
    <div className="inspector-file-group">
      <div className="inspector-file-group__header">
        <span className="inspector-file-group__icon">{icon}</span>
        <span className="inspector-file-group__title">{title}</span>
        <span className="inspector-file-group__count">{files.length}</span>
      </div>
      <div className="inspector-file-group__list">
        {files.map(file => (
          <FileCard
            key={file.path}
            file={file}
            selected={selectedFile === file.path}
            onClick={() => onSelect(file.path)}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * InspectorFileBrowser — 인스펙터 파일 목록 브라우저.
 * 그룹화된 파일 카드 목록 제공.
 * @returns 파일 브라우저 JSX 요소
 */
export const InspectorFileBrowser: React.FC<{
  response: AgentInspectorResponse;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}> = ({ response, selectedFile, onSelectFile }) => {
  const allFiles: { file: AgentInspectorFileModel; group: string }[] = [];
  if (response.agentToml) allFiles.push({ file: response.agentToml, group: 'config' });
  if (response.agentJson) allFiles.push({ file: response.agentJson, group: 'config' });
  if (response.skillMarkdown) allFiles.push({ file: response.skillMarkdown, group: 'skill' });
  for (const ref of response.references) allFiles.push({ file: ref, group: 'refs' });
  for (const script of response.scripts) allFiles.push({ file: script, group: 'scripts' });
  for (const asset of response.assets) allFiles.push({ file: asset, group: 'assets' });

  return (
    <div className="inspector-file-browser">
      <div className="inspector-file-browser__header">
        <span className="codicon codicon-files" />
        <span>Skill Files</span>
        <span className="inspector-file-browser__count">{allFiles.length}개</span>
      </div>
      <div className="inspector-file-browser__body">
        {response.agentToml || response.agentJson ? (
          <FileGroup
            title="설정"
            icon="⚙️"
            files={[response.agentToml, response.agentJson].filter(Boolean) as AgentInspectorFileModel[]}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        ) : null}
        {response.skillMarkdown ? (
          <FileGroup
            title="Skill Definition"
            icon="📝"
            files={[response.skillMarkdown]}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        ) : null}
        {response.references.length > 0 && (
          <FileGroup
            title="참조 문서"
            icon="📚"
            files={response.references}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {response.scripts.length > 0 && (
          <FileGroup
            title="스크립트"
            icon="⚡"
            files={response.scripts}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {response.assets.length > 0 && (
          <FileGroup
            title="에셋"
            icon="📦"
            files={response.assets}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {allFiles.length === 0 && (
          <div className="inspector-file-browser__empty">
            <span className="codicon codicon-files" style={{ fontSize: '32px', opacity: 0.2 }} />
            <p>No skill files for this agent.</p>
          </div>
        )}
      </div>
    </div>
  );
};
