"use client";

import { ArrowUpRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ExampleRows({ protectedView }: { protectedView: boolean }) {
  return (
    <div className="example-rows">
      <div><span>Agreed fee floor</span><strong>$100</strong></div>
      <div><span>Actual eligible fees</span><strong>$40</strong></div>
      {protectedView && <div><span>Illustrative cover premium</span><strong>− $12</strong></div>}
      {protectedView && <div className="payout-row"><span>Shortfall paid from cover</span><strong>+ $60</strong></div>}
    </div>
  );
}

export function ExampleTabs() {
  return (
    <Tabs defaultValue="with" className="example-card">
      <div className="example-card-heading"><span>ETH / USDC</span><span>7 DAY WINDOW ↗</span></div>
      <TabsList className="example-tab-list" aria-label="Compare fee outcomes">
        <TabsTrigger className="example-tab-trigger" value="without">Without cover</TabsTrigger>
        <TabsTrigger className="example-tab-trigger" value="with">With Nacre</TabsTrigger>
      </TabsList>
      <TabsContent value="without" className="example-tab-content">
        <div className="outcome-heading"><span>FEE INCOME RECEIVED</span><ArrowUpRight size={21} aria-hidden="true" /></div>
        <div className="outcome-value">$40<span> / $100 target</span></div>
        <div className="outcome-meter"><span style={{ width: "40%" }} /></div>
        <ExampleRows protectedView={false} />
        <p className="outcome-caption">The remaining $60 of the target is simply missed.</p>
      </TabsContent>
      <TabsContent value="with" className="example-tab-content">
        <div className="outcome-heading"><span>ILLUSTRATIVE NET INCOME</span><ArrowUpRight size={21} aria-hidden="true" /></div>
        <div className="outcome-value">$88<span> after $12 premium</span></div>
        <div className="outcome-meter"><span style={{ width: "88%" }} /></div>
        <ExampleRows protectedView />
        <p className="outcome-caption">$40 in fees + $60 cover payout − $12 premium.</p>
      </TabsContent>
      <div className="example-disclaimer">For illustration only. Pricing, eligibility, and settlement are proposed mechanics.</div>
    </Tabs>
  );
}
