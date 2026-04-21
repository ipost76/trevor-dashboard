"use client";

import TabContainer from "@/components/TabContainer";
import TradesPanel from "./panels/TradesPanel";
import HoldingsPanel from "./panels/HoldingsPanel";
import AutoTraderPanel from "./panels/AutoTraderPanel";

export default function TradingPage() {
  return (
    <TabContainer
      pageTitle="TRADING"
      defaultTab="trades"
      tabs={[
        { id: "trades", label: "Trades", content: <TradesPanel /> },
        { id: "holdings", label: "Holdings", content: <HoldingsPanel /> },
        { id: "autotrader", label: "Auto Trader", content: <AutoTraderPanel /> },
      ]}
    />
  );
}
