import { KiroDefaultAgent } from './KiroDefaultAgent';
import { KiroFolderSetting } from './KiroFolderSetting';

interface KiroChatDefaultsProps {
  /** Kiro is signed in: the settings show only then */
  signedIn: boolean;
  defaultAgent: string | undefined;
  onDefaultAgentChange: (agentId: string | undefined) => void;
}

/** What a new Kiro chat starts with: its folder (D6) and its agent (D9) */
export function KiroChatDefaults({
  signedIn,
  defaultAgent,
  onDefaultAgentChange,
}: KiroChatDefaultsProps) {
  if (!signedIn) return null;
  return (
    <>
      <KiroFolderSetting />
      <KiroDefaultAgent value={defaultAgent} onChange={onDefaultAgentChange} />
    </>
  );
}
