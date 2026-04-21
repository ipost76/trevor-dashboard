"use client";

import TabContainer from "@/components/TabContainer";
import TradesPanel from "./panels/TradesPanel";
import HoldingsPanel from "./panels/HoldingsPanel";

export default function TradingPage() {
  return (
    <TabContainer
      pageTitle="TRADING"
      defaultTab="trades"
      tabs={[
        { id: "trades", label: "Trades", content: <TradesPanel /> },
        { id: "holdings", label: "Holdings", content: <HoldingsPanel /> },
      ]}
    />
  );
}
