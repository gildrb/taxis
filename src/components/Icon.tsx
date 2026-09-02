interface IconProps {
  name: "upload" | "undo" | "redo" | "shuffle" | "reset" | "lock" | "download" | "mic" | "image";
  size?: number;
}

const paths: Record<IconProps["name"], React.ReactNode> = {
  upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></>,
  undo: <><path d="m9 7-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></>,
  redo: <><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></>,
  shuffle: <><path d="M4 7h3c4 0 6 10 10 10h3"/><path d="m17 14 3 3-3 3"/><path d="M4 17h3c1.6 0 2.9-1.6 4.1-3.6"/><path d="M14 7c1-1.2 2-2 3-2h3"/><path d="m17 2 3 3-3 3"/></>,
  reset: <><path d="M4 11a8 8 0 1 1 2.3 6"/><path d="M4 5v6h6"/></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  download: <><path d="M12 4v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></>,
};

export function Icon({ name, size = 17 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
