"use client";
import { ReactNode } from "react";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Avatar,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import ViewAgendaOutlinedIcon from "@mui/icons-material/ViewAgendaOutlined";
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { ui, fonts } from "@/theme/tokens";
import { useScrapeProgress } from "@/context/ScrapeProgressContext";
import { Wordmark } from "@/components/ui/Wordmark";

const HOME_PATH = "/";
const LOGIN_PATH = "/login";
const DRAWER_WIDTH = { xs: 60, md: 220 };
const CONTENT_MAX_WIDTH = 1040;

const VISIBLE_WHEN_EXPANDED = { xs: "none", md: "block" } as const;
const VISIBLE_WHEN_COLLAPSED = { xs: "block", md: "none" } as const;
const CENTERED_WHEN_COLLAPSED = { xs: "center", md: "flex-start" } as const;

interface NavItem {
  label: string;
  href: string;
  Icon: SvgIconComponent;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Search jobs", href: HOME_PATH, Icon: SearchRoundedIcon },
  { label: "Saved", href: "/favourites", Icon: BookmarkBorderRoundedIcon },
  { label: "Dashboard", href: "/dashboard", Icon: ViewAgendaOutlinedIcon },
  { label: "Interviews", href: "/interviews", Icon: CalendarTodayOutlinedIcon },
  { label: "Stats", href: "/stats", Icon: BarChartRoundedIcon },
];

const SETTINGS_ITEM: NavItem = { label: "Settings", href: "/settings", Icon: SettingsOutlinedIcon };

function isActiveSection(pathname: string, href: string): boolean {
  if (href === HOME_PATH) return pathname === HOME_PATH;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ACTIVE_NAV_MARKER = {
  content: '""',
  position: "absolute",
  left: -8,
  top: 8,
  bottom: 8,
  width: 2,
  borderRadius: 1,
  backgroundColor: ui.accent,
} as const;

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  trailing?: ReactNode;
}

function NavLink({ item, active, trailing }: NavLinkProps) {
  const { Icon } = item;
  return (
    <ListItemButton
      component={Link}
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      sx={{
        position: "relative",
        mb: 0.25,
        py: 0.875,
        px: 1.25,
        justifyContent: CENTERED_WHEN_COLLAPSED,
        color: active ? ui.text : ui.textMuted,
        backgroundColor: active ? ui.surface : "transparent",
        "&:hover": { backgroundColor: active ? ui.surface : ui.raised, color: ui.text },
        ...(active && { "&::before": ACTIVE_NAV_MARKER }),
      }}
    >
      <ListItemIcon sx={{ minWidth: { xs: 0, md: 30 } }}>
        <Icon sx={{ fontSize: 18 }} />
      </ListItemIcon>
      <ListItemText
        primary={item.label}
        sx={{ my: 0, display: VISIBLE_WHEN_EXPANDED }}
        primaryTypographyProps={{ fontSize: "0.875rem", fontWeight: active ? 600 : 500 }}
      />
      {trailing}
    </ListItemButton>
  );
}

function ScrapeProgressBadge({ percent }: { percent: number }) {
  return (
    <>
      <Typography
        sx={{
          display: VISIBLE_WHEN_EXPANDED,
          fontFamily: fonts.mono,
          fontSize: "0.6875rem",
          color: ui.accent,
        }}
      >
        {percent}%
      </Typography>
      <Box
        sx={{
          display: VISIBLE_WHEN_COLLAPSED,
          position: "absolute",
          top: 7,
          right: 9,
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: ui.accent,
        }}
      />
    </>
  );
}

function AccountFooter({ user }: { user: Session["user"] }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        alignItems: "center",
        gap: 1,
        px: { xs: 0, md: 1 },
      }}
    >
      <Avatar src={user.image ?? undefined} alt={user.name ?? "User"} sx={{ width: 26, height: 26 }}>
        {user.name?.[0]?.toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0, flexGrow: 1, display: VISIBLE_WHEN_EXPANDED }}>
        <Typography noWrap sx={{ fontSize: "0.8125rem", fontWeight: 500, lineHeight: 1.3 }}>
          {user.name}
        </Typography>
        {user.email && (
          <Typography noWrap sx={{ fontFamily: fonts.mono, fontSize: "0.6875rem", color: ui.textFaint }}>
            {user.email}
          </Typography>
        )}
      </Box>
      <Tooltip title="Log out" placement="right">
        <IconButton size="small" aria-label="Log out" onClick={() => signOut({ callbackUrl: LOGIN_PATH })}>
          <LogoutRoundedIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { scraping, scrapePercent } = useScrapeProgress();
  const { data: session } = useSession();

  if (pathname.startsWith(LOGIN_PATH)) {
    return <>{children}</>;
  }

  const searchProgress = scraping ? <ScrapeProgressBadge percent={scrapePercent} /> : null;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            overflowX: "hidden",
          },
        }}
      >
        <Box
          component={Link}
          href={HOME_PATH}
          aria-label="2LLAZY home"
          sx={{
            display: "flex",
            justifyContent: CENTERED_WHEN_COLLAPSED,
            px: { xs: 0, md: 2.25 },
            pt: 2.75,
            pb: 3,
            textDecoration: "none",
          }}
        >
          <Wordmark size={{ xs: 9, md: 16 }} />
        </Box>

        <List sx={{ px: 1, pt: 0 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActiveSection(pathname, item.href)}
              trailing={item.href === HOME_PATH ? searchProgress : undefined}
            />
          ))}
        </List>

        <Box sx={{ mt: "auto", px: 1, pb: 1.5 }}>
          <List disablePadding>
            <NavLink item={SETTINGS_ITEM} active={isActiveSection(pathname, SETTINGS_ITEM.href)} />
          </List>
          <Divider sx={{ my: 1.25, mx: 0.5 }} />
          {session?.user && <AccountFooter user={session.user} />}
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ maxWidth: CONTENT_MAX_WIDTH, px: { xs: 2, sm: 3, md: 5 }, pt: { xs: 3, md: 5 }, pb: 8 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
