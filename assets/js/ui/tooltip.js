/**
 * Smart Tooltip Positioning
 * Keeps tooltips within viewport bounds.
 */

/**
 * Position tooltip smartly to avoid viewport edges
 */
export function positionTooltip(event, tooltipElement) {
  if (!tooltipElement || !tooltipElement.node) return;
  // On mobile, tooltip is a CSS bottom sheet — skip coordinate positioning
  if (window.innerWidth <= 900) return;
  
  const tooltip = tooltipElement.node();
  const mouseX = event.pageX;
  const mouseY = event.pageY;
  const offset = 15;
  
  // Get tooltip dimensions
  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipWidth = tooltipRect.width;
  const tooltipHeight = tooltipRect.height;
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.pageXOffset;
  const scrollY = window.pageYOffset;
  
  // Calculate initial position (right and below cursor)
  let left = mouseX + offset;
  let top = mouseY + offset;
  
  // Check if tooltip goes off right edge
  if (left + tooltipWidth > scrollX + viewportWidth) {
    // Place to the left of cursor instead
    left = mouseX - tooltipWidth - offset;
  }
  
  // Check if tooltip goes off bottom edge
  if (top + tooltipHeight > scrollY + viewportHeight) {
    // Place above cursor instead
    top = mouseY - tooltipHeight - offset;
  }
  
  // Ensure we don't go off left edge
  if (left < scrollX) {
    left = scrollX + 5;
  }
  
  // Ensure we don't go off top edge
  if (top < scrollY) {
    top = scrollY + 5;
  }
  
  tooltipElement
    .style('left', `${left}px`)
    .style('top', `${top}px`);
}
