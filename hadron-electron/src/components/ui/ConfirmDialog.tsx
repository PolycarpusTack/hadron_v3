import { useCallback, useState } from 'react';
import Modal from './Modal';
import Button from './Button';

interface ConfirmState {
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

interface ConfirmDialogProps {
  state: ConfirmState;
}

function ConfirmDialogInner({ state }: ConfirmDialogProps) {
  return (
    <Modal isOpen onClose={() => state.resolve(false)} maxWidth="max-w-sm" closeOnBackdrop={false}>
      <div className="hd-modal-shell p-6 space-y-4">
        {state.title && (
          <h2 className="text-base font-semibold" style={{ color: 'var(--hd-text)' }}>{state.title}</h2>
        )}
        <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>{state.message}</p>
        <div className="flex gap-3 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={() => state.resolve(false)}>
            Cancel
          </Button>
          <Button
            variant={state.destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={() => state.resolve(true)}
          >
            {state.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export interface UseConfirmReturn {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactElement | null;
}

export function useConfirm(): UseConfirmReturn {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((message: string, options?: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        message,
        title: options?.title,
        confirmLabel: options?.confirmLabel,
        destructive: options?.destructive,
        resolve: (ok) => {
          setState(null);
          resolve(ok);
        },
      });
    });
  }, []);

  const dialog = state ? <ConfirmDialogInner state={state} /> : null;
  return { confirm, dialog };
}
