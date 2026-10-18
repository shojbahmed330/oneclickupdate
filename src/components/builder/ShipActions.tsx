import { GithubButton } from "./GithubButton";
import { BrandingButton } from "./BrandingButton";
import { BuildApkButton } from "./BuildApkButton";

interface Props {
  projectId: string;
  projectName?: string;
  onGithubCommand?: (prompt: string) => void;
}

export function ShipActions({ projectId, projectName, onGithubCommand }: Props) {
  return (
    <>
      <GithubButton projectId={projectId} projectName={projectName} onRunCommand={onGithubCommand} />
      <BrandingButton projectId={projectId} />
      <BuildApkButton projectId={projectId} />
    </>
  );
}
