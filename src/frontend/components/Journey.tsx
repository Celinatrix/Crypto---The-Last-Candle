"use client";

import { Fragment, type ReactNode } from "react";
import { useMember } from "./MemberProvider";

/**
 * A device with a saved link comes back for its numbers; anyone else first needs to know how to join.
 * The server cannot see the link, so it renders the newcomer's order and a linked device swaps once
 * mounted. Both sections start below the first screen, so nothing on screen moves.
 */
export default function Journey({ members, premium }: { members: ReactNode; premium: ReactNode }) {
  const { expiresAt } = useMember();
  const sections = [
    { key: "premium", node: premium },
    { key: "members", node: members },
  ];
  if (expiresAt !== null) sections.reverse();

  return (
    <>
      {sections.map((s) => (
        <Fragment key={s.key}>{s.node}</Fragment>
      ))}
    </>
  );
}
