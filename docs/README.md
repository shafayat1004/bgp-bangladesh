# User Guide - BGP Bangladesh

## Understanding the Visualization

### What is BGP?

**BGP (Border Gateway Protocol)** is the routing protocol that makes the internet work. It's how different networks (called Autonomous Systems or ASNs) agree on how to send traffic between each other. Think of it as the GPS for internet traffic.

### What are ASNs?

Every major network has a unique **ASN (Autonomous System Number)**. For example:
- **AS58717** = Summit Communications (Bangladesh)
- **AS9498** = Bharti Airtel (India)
- **AS6939** = Hurricane Electric (USA)

### How Bangladesh Connects to the World

Internet traffic from Bangladesh follows this path:

1. **Your device** connects to your **local company/ISP**
2. Your ISP routes traffic through **border gateways** (IIGs - International Internet Gateways)
3. These gateways connect to **international transit providers** (Outside BD ASNs)
4. Transit providers deliver traffic to the **global internet**

### What the Colors Mean (6 Categories)

- **Blue nodes** = Local Companies - Bangladeshi ISPs and origin networks
- **Green nodes** = IIGs (Licensed Gateways) - BTRC-licensed border gateway operators
- **Amber nodes** = Detected Gateways - Acting as gateways but not in the known BTRC IIG list
- **Cyan nodes** = Offshore Enterprises - BD-registered ASNs with infrastructure abroad, no transit role (e.g., Chaldal)
- **Pink nodes** = Offshore Gateways - BD-registered, abroad, but providing transit to BD networks
- **Red nodes** = Outside BD (International Feeders) - Foreign transit networks
- **Lines/arrows** = BGP routing paths between networks
- **Thicker lines** = More routes flowing through that path

## Using the Tool

### Viewing Static Data

The page loads with a pre-existing snapshot of BGP data. This is fast and works offline.

### Fetching Live Data

1. Click **"Fetch Live Data"** in the sidebar
2. Wait for the progress bar to complete (~60-90 seconds)
3. The visualization updates with current BGP routing data
4. You can cancel at any time

### Switching Visualizations

Use the **tab bar** at the top to switch between 6 different views:

- **Network Graph**: Drag nodes, zoom, click to explore connections
- **Traffic Flow**: See volume flowing from international to domestic networks
- **Market Share**: Quick visual of which ASNs dominate
- **Chord Diagram**: Circular view of who connects to whom
- **Layered View**: Clean presentation-ready top-to-bottom layout
- **Data Table**: Sort, search, and page through exact numbers

### Exporting Data

Click the export buttons in the sidebar:
- **Nodes CSV**: ASN list with route stats (opens in Excel/Google Sheets)
- **Edges CSV**: Connection list with route counts
- **JSON**: Full dataset (can be used as static data)

### Filtering

- **Min Routes slider**: Hide low-route connections to focus on major paths
- **Node Size slider**: Adjust visual prominence of nodes

## Why This Matters

Understanding BGP paths reveals:

1. **Bottlenecks**: A few ASNs carry most of Bangladesh's international traffic
2. **Dependencies**: Heavy reliance on specific Indian and US transit providers
3. **Resilience**: Limited path diversity means outages have outsized impact
4. **Transparency**: See who controls the paths your internet traffic takes
