// Minimal, consistent stroke icon set (24x24). No icon library needed.
function base(props) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: props?.className ? undefined : 20,
    height: props?.className ? undefined : 20,
    ...props,
  };
}

export const IconHome = (p) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.8V21h14V9.8" />
    <path d="M9.5 21v-6h5v6" />
  </svg>
);

export const IconCart = (p) => (
  <svg {...base(p)}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M3 4h2l2.5 12.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20.5 8H6" />
  </svg>
);

export const IconBox = (p) => (
  <svg {...base(p)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.3 7.2 12 12l8.7-4.8" />
    <path d="M12 22V12" />
  </svg>
);

export const IconTag = (p) => (
  <svg {...base(p)}>
    <path d="M2 12.6V4a2 2 0 0 1 2-2h8.6L22 9.4a2 2 0 0 1 0 2.8l-7.6 7.6a2 2 0 0 1-2.8 0L2 12.6z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </svg>
);

export const IconLayers = (p) => (
  <svg {...base(p)}>
    <path d="m12 2 10 5-10 5L2 7l10-5z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </svg>
);

export const IconTruck = (p) => (
  <svg {...base(p)}>
    <path d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2" />
    <path d="M14 8h4l3 4v4a1 1 0 0 1-1 1h-2" />
    <path d="M9 17h6" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);

export const IconReceipt = (p) => (
  <svg {...base(p)}>
    <path d="M5 2h14v20l-2.3-1.6L14.4 22l-2.4-1.6L9.6 22l-2.3-1.6L5 22V2z" />
    <path d="M9 7h6" />
    <path d="M9 11h6" />
  </svg>
);

export const IconCalendar = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
  </svg>
);

export const IconChart = (p) => (
  <svg {...base(p)}>
    <path d="M3 3v18h18" />
    <path d="M8 17v-5" />
    <path d="M13 17V8" />
    <path d="M18 17v-3" />
  </svg>
);

export const IconUsers = (p) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
    <circle cx="17.5" cy="9.5" r="2.5" />
    <path d="M17.5 14.5c2.3.3 3.9 1.9 4.5 4.5" />
  </svg>
);

export const IconSliders = (p) => (
  <svg {...base(p)}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
    <circle cx="15" cy="6" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="13" cy="18" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconUser = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </svg>
);

export const IconLogout = (p) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const IconSearch = (p) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconPlus = (p) => (
  <svg {...base(p)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export const IconMinus = (p) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconTrash = (p) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="m6.5 7 .8 13a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-13" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const IconPencil = (p) => (
  <svg {...base(p)}>
    <path d="m4 20 4.5-.9L20 7.6a2 2 0 0 0-2.8-2.8L5.7 16.3 4 20z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
);

export const IconX = (p) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12" />
    <path d="M18 6 6 18" />
  </svg>
);

export const IconCheck = (p) => (
  <svg {...base(p)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export const IconPrinter = (p) => (
  <svg {...base(p)}>
    <path d="M7 8V3h10v5" />
    <rect x="3" y="8" width="18" height="8" rx="1.5" />
    <path d="M7 14h10v7H7z" />
  </svg>
);

export const IconDownload = (p) => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);

export const IconRefresh = (p) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.4 2.6L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const IconAlert = (p) => (
  <svg {...base(p)}>
    <path d="M12 3 2.5 20h19L12 3z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconEye = (p) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconEyeOff = (p) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .4 4.3 1M21.5 12S18 18.5 12 18.5c-1.6 0-3-.4-4.3-1" />
    <path d="m4 4 16 16" />
  </svg>
);

export const IconCopy = (p) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconArrowLeft = (p) => (
  <svg {...base(p)}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

export const IconChevronRight = (p) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconGlass = (p) => (
  <svg {...base(p)}>
    <path d="M8 5h8l-1 15a1 1 0 0 1-1 .9h-4a1 1 0 0 1-1-.9L8 5z" />
    <path d="M7.6 10h8.8" />
    <path d="m12.5 5 2.5-3" />
  </svg>
);

export const IconInstall = (p) => (
  <svg {...base(p)}>
    <rect x="5" y="2" width="14" height="20" rx="2.5" />
    <path d="M12 7v6" />
    <path d="m9.5 10.5 2.5 2.5 2.5-2.5" />
  </svg>
);

export const IconUpload = (p) => (
  <svg {...base(p)}>
    <path d="M12 15V4" />
    <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
    <path d="M4 15v4a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-4" />
  </svg>
);

export const IconWallet = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <path d="M7 15h4" />
  </svg>
);

export const IconScale = (p) => (
  <svg {...base(p)}>
    <path d="M12 4v16" />
    <path d="M6 20h12" />
    <path d="M5 7h14" />
    <path d="m5 7-2.5 5a3 3 0 0 0 5 0L5 7Z" />
    <path d="m19 7-2.5 5a3 3 0 0 0 5 0L19 7Z" />
  </svg>
);

export const IconTarget = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" />
  </svg>
);

export const IconFlame = (p) => (
  <svg {...base(p)}>
    <path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-1.8.8-3.4 1.8-4.7C9.6 8.6 10 10 11 10c1.2 0 1-2.5 1-4.5C12 5 12 3 12 3Z" />
  </svg>
);
