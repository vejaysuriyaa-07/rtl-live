export const REPO_ROOT: string;
export const REPO_FIXTURES: string;
export function isolatedLaunch(label: string): {
  root: string;
  userDataDir: string;
  extensionsDir: string;
  workspaceFolder: string;
  launchArgs: string[];
};
