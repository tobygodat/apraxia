import { type ReactNode, useId } from "react";
import { Dialog } from "../components/dialog/Dialog";
import "./workspace.css";
import "./workspacePaper.css";

export function WorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog
      labelledBy={id}
      onClose={onClose}
      closeOnBackdrop
      className="workspace-dialog"
      backdropClassName="workspace-dialog-backdrop"
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      {children}
    </Dialog>
  );
}
