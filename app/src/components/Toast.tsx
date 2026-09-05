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
        background: 'rgba(14, 26, 50, 0.78)',
        border: '1px solid var(--lineB)',
        color: 'var(--ink)',
        borderRadius: 999,
        padding: '12px 22px',
        fontWeight: 600,
        fontSize: 12,
        boxShadow: 'var(--shadow)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        whiteSpace: 'nowrap',
        animation: 'cvpop .35s cubic-bezier(.2,.85,.25,1.1) both',
      }}
    >
      {message}
    </div>
  );
}
