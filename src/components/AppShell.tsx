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
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DashboardIcon from "@mui/icons-material/Dashboard";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SettingsIcon from "@mui/icons-material/Settings";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import LogoutIcon from "@mui/icons-material/Logout";
import BoltIcon from "@mui/icons-material/Bolt";
import BarChartIcon from "@mui/icons-material/BarChart";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ios } from "@/theme/theme";
import { useScrapeProgress } from "@/context/ScrapeProgressContext";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";

const DRAWER_WIDTH = 236;

const NAV_ITEMS = [
  { label: "Search Jobs", href: "/", icon: <SearchIcon fontSize="small" /> },
  { label: "Favourites", href: "/favourites", icon: <BookmarkIcon fontSize="small" /> },
  { label: "Dashboard", href: "/dashboard", icon: <DashboardIcon fontSize="small" /> },
  { label: "Stats", href: "/stats", icon: <BarChartIcon fontSize="small" /> },
  { label: "Interviews", href: "/interviews", icon: <CalendarMonthIcon fontSize="small" /> },
  { label: "Settings", href: "/settings", icon: <SettingsIcon fontSize="small" /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { scraping, scrapePercent } = useScrapeProgress();
  const { data: session } = useSession();

  // Login page: render without the shell
  if (pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
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
          },
        }}
      >
        {/* Logo */}
        <Box sx={{ px: 2.5, pt: 3, pb: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: "8px",
              background: ios.label1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <BoltIcon sx={{ color: ios.surface1, fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{
              color: ios.label1,
              fontFamily: "'Charter', 'Iowan Old Style', Georgia, serif",
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0em",
            }}>
              2LLazy
            </Typography>
            <Typography sx={{
              color: ios.label3,
              fontSize: 11,
              fontWeight: 400,
              lineHeight: 1.2,
              letterSpacing: "0.02em",
            }}>
              Job Tracker
            </Typography>
          </Box>
        </Box>

        {/* Separator */}
        <Box sx={{ mx: 2, height: "1px", background: ios.separator, mb: 1.5 }} />

        {/* Nav items */}
        <List sx={{ px: 1.5, flexGrow: 1, pt: 0 }}>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <ListItemButton
                key={item.href}
                component={Link}
                href={item.href}
                selected={active}
                sx={{
                  borderRadius: "6px",
                  mb: 0.25,
                  py: 1,
                  px: 1.5,
                  transition: "background 0.12s ease",
                  ...(active ? {
                    background: ios.surface2,
                    "&:hover": { background: ios.surface2 },
                    "&.Mui-selected": {
                      background: ios.surface2,
                      "&:hover": { background: ios.surface2 },
                    },
                  } : {
                    "&:hover": { background: alpha(ios.surface2, 0.6) },
                  }),
                  "& .MuiListItemIcon-root": {
                    color: active ? ios.label1 : ios.label3,
                    minWidth: 34,
                    transition: "color 0.15s ease",
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    color: active ? ios.label1 : ios.label2,
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>

        {/* User info + Logout */}
        <Box sx={{ p: 1.5, pt: 0 }}>
          <Box sx={{ height: "1px", background: ios.separator, mb: 1.5 }} />
          {session?.user && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 0.5, mb: 1 }}>
              <Avatar
                src={session.user.image ?? undefined}
                alt={session.user.name ?? "User"}
                sx={{ width: 32, height: 32, fontSize: 13 }}
              >
                {session.user.name?.[0]?.toUpperCase()}
              </Avatar>
              <Typography sx={{
                color: ios.label2,
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {session.user.name}
              </Typography>
            </Box>
          )}
          <ListItemButton
            onClick={() => signOut({ callbackUrl: "/login" })}
            sx={{
              borderRadius: "6px",
              py: 1,
              px: 1.5,
              transition: "background 0.12s ease",
              "&:hover": { background: alpha(ios.red, 0.07) },
              "& .MuiListItemIcon-root": {
                color: ios.label3,
                minWidth: 34,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 34 }}>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Log out"
              primaryTypographyProps={{
                fontSize: 14,
                fontWeight: 400,
                color: ios.label2,
              }}
            />
          </ListItemButton>
        </Box>
      </Drawer>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflow: "auto",
          minHeight: "100vh",
          background: ios.bg,
          position: "relative",
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, p: 3 }}>
          {children}
        </Box>
      </Box>
      {/* ── Global scrape progress circle (top-right, persists across pages) ── */}
      {scraping && (
        <Tooltip title={`Searching jobs… ${scrapePercent}%`} placement="left">
          <Box
            component={Link}
            href="/"
            sx={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 1400,
              width: 64,
              height: 64,
              borderRadius: "50%",
              bgcolor: "background.paper",
              boxShadow: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              textDecoration: "none",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
              "&:hover": { transform: "scale(1.08)", boxShadow: 10 },
              "&:active": { transform: "scale(0.96)" },
            }}
          >
            <CircularProgress
              variant="determinate"
              value={scrapePercent}
              size={56}
              thickness={4}
              sx={{ color: scrapePercent === 100 ? "success.main" : "primary.main", position: "absolute" }}
            />
            {/* Track ring */}
            <CircularProgress
              variant="determinate"
              value={100}
              size={56}
              thickness={4}
              sx={{ color: "action.disabledBackground", position: "absolute" }}
            />
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, fontSize: "0.68rem", color: "text.primary", zIndex: 1 }}
            >
              {scrapePercent}%
            </Typography>
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
