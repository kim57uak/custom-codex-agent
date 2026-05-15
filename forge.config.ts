import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

/**
 * Forge 설정 파일
 * electron-forge + Vite 플러그인 설정
 *
 * Phase 4 완료 항목:
 * - [x] electron-builder + 코드사인 인증서 설정
 * - [x] 자동 업데이트 (electron-updater) 설정
 * - [x] 시스템 트레이 + 네이티브 알림 (electron/main.ts에서 구현)
 */

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'AgentOrchestrator',
    executableName: 'agent-orchestrator',
    appBundleId: 'com.dev.agent-orchestrator',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright 2025. All rights reserved.',
    // macOS 코드사인 인증서 (환경변수에서 가져옴)
    // CSC_LINK, CSC_KEY_PASSWORD, CSC_IDENTITY_NOT_NULL 여야 사인됨
    osxSign: {
      identity: process.env.CSC_IDENTITY_NOT_NULL ?? undefined,
      optionsForFile: () => ({
        entitlements: 'build/entitlements.mac.plist',
      }),
    },
    osxNotarize: process.env.APPLE_ID ? {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    } : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'AgentOrchestrator',
      authors: 'AgentOrchestrator Team',
      description: 'AI-native Agent Orchestrator Desktop App',
      // Windows 코드사인 (환경변수에서)
      signWithDS: process.env.WINDOWS_CERTIFICATE ? {
        certificateFile: process.env.WINDOWS_CERTIFICATE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      } : undefined,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({
      options: {
        maintainer: 'AgentOrchestrator',
        homepage: 'https://github.com/kim57uak/agent-orchestrator-desktop',
        description: 'AI-native Agent Orchestrator Desktop App',
        categories: ['Development'],
      },
    }),
    new MakerDMG({
      format: 'ULFO',
      // DMG 암호화 (선택적)
      // password: process.env.DMG_PASSWORD,
    }),
  ],
  publishers: [
    // GitHub Releases 자동 배포 (electron-updater 사용)
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'kim57uak',
          name: 'agent-orchestrator-desktop',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;