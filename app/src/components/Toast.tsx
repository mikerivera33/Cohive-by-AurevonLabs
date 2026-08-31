export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="grot"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 104,
        transform: 'translateX(-50%)',
        zIndex: 60,
        background: 'var(--panelS)',
        border: '1px solid var(--lineB)',
        borderLeft: '3px solid var(--honey)',
        color: 'var(--ink)',
        borderRadius: 13,
        padding: '11px 20px',
        fontWeight: 600,
        fontSize: 12,
        boxShadow: 'var(--shadow)',
        whiteSpace: 'nowrap',
        animation: 'cvpop .3s ease both',
      }}
    >
      {message}
    </div>
  );
}
