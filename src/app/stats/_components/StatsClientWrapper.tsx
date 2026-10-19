"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { StatsClient } from "./StatsClient";

type Props = ComponentProps<typeof StatsClient>;

const StatsClientDynamic = dynamic(
  () => import("./StatsClient").then((m) => m.StatsClient),
  { ssr: false },
);

export function StatsClientWrapper(props: Props) {
  return <StatsClientDynamic {...props} />;
}
