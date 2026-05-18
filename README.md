# Interactive Dielectrophoresis (pDEP) Explorer

An interactive web-based simulation and visualisation tool for exploring particle behavior under dielectrophoretic forces in microfluidic channels.

## Overview

This project simulates a simplified model of the physics **dielectrophoresis (DEP)**, a technique used to manipulate and separate particles (such as cells) using electric fields. The tool provides real-time visualisation of particle motion, capture, and output tracking across different particle populations.

## Notes

This is a simplified educational model of dielectrophoresis. Real-world systems involve more complex interactions including:
- Induced dipole moment frequency dependence (Clausius-Mossotti factor)
- Non-uniform field distributions
- Brownian motion
- Particle-particle interactions
- Electrokinetic flows

## Features

### Simulation Controls
- **Voltage Control**: Adjust the applied electric potential to influence dielectrophoretic forces
- **Frequency Control**: Tune the operating frequency to target specific particle populations
- **Flow Rate**: Control the laminar flow velocity through the channel
- **Spawn Rate** (0-100/s): Adjust particle generation rate
- **Target Particle Count** (200-10,000): Set the maximum number of particles to maintain
- **Capture Toggle**: Enable/disable dielectrophoretic capture of particles

### Multi-Population Support
Define and manage multiple particle populations with:
- Custom names and colors
- Frequency response curves (Gaussian peaks)
- Individual share percentages
- Real-time population tracking

### Visualisation
- **Top View**: Particles moving left to right with electrodes spanning the channel width
- **Front View**: Cross-sectional view showing electrode placement and vertical particle movement
- **Field Overlay**: Optional visualisation of electric field strength and direction
- **Response Chart**: Gaussian frequency response curves for each population
- **Output Chart**: Real-time tracker of particles exiting the channel

### Physics Simulation
- **Laminar Flow**: Particle transport through the channel
- **Dielectrophoretic Forces**: Frequency-dependent capture mechanism
- **Detachment**: Voltage-dependent release with probabilistic escape
- **Multi-view Field Computation**: Front and top-view electric field calculations

## How to Use

This project is hosted on GitHub Pages at: 
[mcgurk94.github.io/dep_sandbox](https://mcgurk94.github.io/dep_sandbox).

### Managing Populations
1. Navigate to the **Populations** tab
2. Configure population parameters:
   - **Name**: Label for the population
   - **Color**: Display color (hex format, e.g., `#60a5fa`)
   - **Peak**: Frequency at which this population responds most strongly (Hz)
   - **Width**: Frequency response bandwidth
   - **Share**: Proportion of spawned particles (normalised automatically)
3. Click **Add** to create a new population
4. Click **Remove** on any population item to delete it

### Understanding the Output
- **FPS**: Current frame rate
- **Particles**: Total active particles in the simulation
- **Captured**: Number of particles currently held by electric fields
- **Population Summary**: Count breakdown by population type

### Field visualisation
Select **Field overlay** to visualise electric field strength:
- **Front view**: Shows field distribution in the y-z plane (vertical)
- **Top view**: Shows field distribution in the x-z plane (horizontal)

## Technical Details

### Architecture
The simulation is built with:
- **D3.js**: Charting and data visualisation
- **HTML5 Canvas**: Real-time particle rendering
- **Vanilla JavaScript**: Physics simulation and state management

