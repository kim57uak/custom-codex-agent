/**
 * ErrorBoundary - React 에러 경계 (Per-panel Isolation)
 *
 * CEO Amendment #4: React Error Boundaries (per-panel isolation)
 * - 각 Panel (Org, Dashboard, Console, Workflow, Inspector)이 독립적인 에러 경계
 * - 하나가崩溃しても 다른 패널은 정상 작동
 *
 * 에러 상태:
 * - componentDidCatch: 에러 포착, 상태 업데이트
 * - getDerivedStateFromError: 에러 상태로 렌더링 전환
 *
 * UI:
 * - 에러发生时: 에러 메시지 + "Retry" 버튼
 * - Retry 클릭 시: 상태 초기화 (테스트 필요)
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary viewId="org">
 *   <OrgView />
 * </ErrorBoundary>
 * ```
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

/**
 * ErrorBoundaryProps
 * - viewId: 현재 경계의 뷰 ID (로깅/식별용)
 * - children: 자식 컴포넌트 (에러 없으면 정상 렌더링)
 */
interface ErrorBoundaryProps {
  viewId: string;
  children: ReactNode;
}

/**
 * ErrorBoundaryState
 */
interface ErrorBoundaryState {
  hasError: boolean;      // 에러 발생 여부
  error: Error | null;    // 포착된 에러 객체
  errorInfo: ErrorInfo | null;  // 에러 상세 정보 (componentStack)
}

/**
 * ErrorBoundary 클래스 컴포넌트
 * - Component 확장 (React 18 ErrorBoundary 규격)
 * - static getDerivedStateFromError: 에러 상태로 전환
 * - componentDidCatch: 에러 로깅 (선택적)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * 에러 상태로 전환 (정적 메서드)
   * - 에러 발생 시 state 업데이트
   * - 다음 렌더링에서 에러 UI 표시
   *
   * @param error 포착된 에러 객체
   * @returns updated state
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  /**
   * 에러 포착 (선택적)
   * - 에러 로깅 (성능监控/디버깅)
   * - DevTools에서確認 가능
   *
   * @param error 포착된 에러 객체
   * @param errorInfo React 에러 정보 (componentStack)
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 에러 로깅 (production에서는 log service로 전송)
    console.error(`[ErrorBoundary:${this.props.viewId}]`, error, errorInfo.componentStack);

    // 에러 상세 정보 저장 (DevTools/UI 표시용)
    this.setState({ errorInfo });
  }

  /**
   * 렌더링
   * - hasError: true → 에러 UI 렌더링
   * - hasError: false → children 정상 렌더링
   */
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          {/* 에러 아이콘 */}
          <div className="error-boundary__icon">
            <span className="codicon codicon-error" />
          </div>

          {/* 에러 메시지 */}
          <div className="error-boundary__content">
            <h3 className="error-boundary__title">
              Something went wrong in {this.props.viewId}
            </h3>

            {/* 에러 상세 (development mode만 표시) */}
            {this.state.error && (
              <p className="error-boundary__message">
                {this.state.error.message}
              </p>
            )}

            {/* componentStack (development mode) */}
            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="error-boundary__details">
                <summary>Stack trace</summary>
                <pre>{this.state.errorInfo.componentStack}</pre>
              </details>
            )}
          </div>

          {/* Retry 버튼 */}
          <button
            className="error-boundary__retry"
            onClick={() => {
              this.setState({
                hasError: false,
                error: null,
                errorInfo: null,
              });
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    // 에러 없음: children 정상 렌더링
    return this.props.children;
  }
}