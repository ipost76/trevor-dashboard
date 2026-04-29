"use client";

import TabContainer from "@/components/TabContainer";
import TradesPanel from "./panels/TradesPanel";

export default function TradingPage() {
  return (
    <TabContainer
      pageTitle="TRADING"
      defaultTab="trades"
      tabs={[
        { id: "trades", label: "Trades", content: <TradesPanel /> },
      ]}
    />
  );
}
