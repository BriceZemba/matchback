// AG Studio theme for the merchant console. Every value points at a Matchback design token from
// app/globals.css, so the console follows the site's light and dark themes: receipt paper, ink,
// price-tag yellow and stamp red.

import { studioTheme } from "ag-studio";

const v = (name: string) => `var(--${name})`;
const line = (color: string, width = 1) => ({ width, color: v(color) });

const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, v(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, v(`chart-${i + 1}`)],
  ]).flat(),
);

export const matchbackStudioTheme = studioTheme.withParams({
  fontFamily: v("sans"),
  fontSize: 14,
  textColor: v("ink"),
  foregroundColor: v("ink"),
  subtleTextColor: v("ink-2"),
  backgroundColor: v("card"),
  borderColor: v("hair"),
  accentColor: v("ink"),
  iconColor: v("ink"),
  rowHoverColor: v("paper-2"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("paper"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("paper"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: v("sans"),

  // Widgets are the site's cards: receipt paper, a 1.5px ink rule, square corners.
  studioWidgetBackgroundColor: v("card"),
  studioWidgetBorder: line("rule", 1.5),
  studioWidgetBorderRadius: 2,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: v("serif"),
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: v("ink"),
  studioWidgetSubtitleFontFamily: v("mono"),
  studioWidgetSubtitleFontSize: 12,
  studioWidgetSubtitleTextColor: v("ink-2"),
  studioWidgetCaptionFontFamily: v("mono"),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: v("ink-3"),
  studioWidgetResizeBorderColor: v("tag"),

  studioPanelContainerBackgroundColor: v("card"),
  studioPanelContainerBorder: line("rule", 1.5),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: v("hair"),
  studioPanelDividerActiveColor: v("tag"),
  studioPanelSectionBorderColor: v("hair"),
  studioPanelHeaderFontFamily: v("mono"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: v("tag"),
  studioPanelChevronButtonHoverColor: v("tag-ink"),
  studioToggleButtonActiveBackgroundColor: v("tag"),
  studioToggleButtonActiveBorderColor: v("rule"),
  studioToggleButtonActiveColor: v("tag-ink"),

  gridFontFamily: v("sans"),
  gridFontSize: 13,
  gridCellTextColor: v("ink"),
  gridHeaderBackgroundColor: v("card"),
  gridHeaderTextColor: v("ink-3"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 11,
  gridRowHeight: 38,
  gridRowBorder: line("hair"),
  gridHeaderRowBorder: line("rule"),
  gridPinnedRowBorder: line("rule"),
  gridRowHoverColor: v("paper-2"),
  gridWrapperBorder: false,

  chartFontFamily: v("sans"),
  chartTextColor: v("ink"),
  chartSubtleTextColor: v("ink-2"),
  chartAxisLineColor: v("rule"),
  chartGridLineColor: v("hair"),
  ...palette,
});
