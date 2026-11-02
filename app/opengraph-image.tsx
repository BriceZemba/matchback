import { ImageResponse } from "next/og";

export const alt = "Matchback: a partial refund instead of a return. Was $274.99, $230.01 elsewhere, $44.98 back through PayPal.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview, drawn as the product's receipt.
export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f3efe6", color: "#161513", padding: 64, justifyContent: "space-between", alignItems: "center", fontFamily: "serif" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 620 }}>
        <div style={{ fontSize: 30, letterSpacing: 3, textTransform: "uppercase", marginBottom: 24 }}>Matchback</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>A partial refund instead of a return</div>
        <div style={{ fontSize: 28, marginTop: 28, color: "#4b4842" }}>An AI agent checks the cheaper offer. Fixed rules decide. PayPal refunds the difference.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: 400, background: "#fbf9f4", border: "3px solid #161513", padding: 32, fontSize: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}><span>Paid</span><span>$274.99</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}><span>Elsewhere, new</span><span>$230.01</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "3px solid #161513", paddingTop: 18, fontSize: 36, fontWeight: 700 }}><span>Back to you</span><span>$44.98</span></div>
        <div style={{ display: "flex", marginTop: 26, alignSelf: "flex-end", color: "#1d6b45", border: "4px solid #1d6b45", padding: "6px 18px", fontSize: 30, fontWeight: 700, letterSpacing: 3, transform: "rotate(-6deg)" }}>MATCHED</div>
      </div>
    </div>,
    size,
  );
}
