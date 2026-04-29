import { Component, JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: JSX.Element;
  /** Optional width in px (default 360). */
  width?: number;
  /** Set to false to disable click-outside / Escape close behaviour. */
  dismissable?: boolean;
}

export const Drawer: Component<DrawerProps> = (props) => {
  const onKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (props.dismissable === false) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', onKey);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onKey);
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.root}
          classList={{ [styles.left]: props.side === 'left', [styles.right]: props.side === 'right' }}
          role="dialog"
          aria-label={props.title ?? 'drawer'}
          aria-modal="false"
        >
          <div
            class={styles.scrim}
            onClick={() => {
              if (props.dismissable !== false) props.onClose();
            }}
          />
          <aside
            class={styles.panel}
            style={{ width: `${props.width ?? 360}px` }}
          >
            <header class={styles.header}>
              <span class={styles.title}>{props.title ?? ''}</span>
              <button
                type="button"
                class={styles.close}
                onClick={props.onClose}
                aria-label="Close drawer"
              >×</button>
            </header>
            <div class={styles.body}>{props.children}</div>
          </aside>
        </div>
      </Portal>
    </Show>
  );
};
