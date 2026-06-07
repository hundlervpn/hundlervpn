'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
}

interface Edge {
  from: number;
  to: number;
}

interface Locator {
  edgeIndex: number;
  progress: number;
  speed: number;
  size: number;
  opacity: number;
}

export default function ParticlesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let locators: Locator[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);
      generateWeb();
    };

    const generateWeb = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const spacing = Math.min(w, h) < 600 ? 80 : 120;
      
      nodes = [];
      edges = [];

      // Generate grid nodes with slight randomization
      const cols = Math.ceil(w / spacing) + 2;
      const rows = Math.ceil(h / spacing) + 2;
      
      for (let row = -1; row < rows; row++) {
        for (let col = -1; col < cols; col++) {
          const x = col * spacing + (Math.random() - 0.5) * spacing * 0.4;
          const y = row * spacing + (Math.random() - 0.5) * spacing * 0.4;
          nodes.push({ x, y });
        }
      }

      // Create edges between nearby nodes
      const maxDist = spacing * 1.6;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist && Math.random() > 0.15) {
            edges.push({ from: i, to: j });
          }
        }
      }

      // Generate locators
      const locatorCount = Math.floor(edges.length * 0.15);
      locators = [];
      for (let i = 0; i < locatorCount; i++) {
        locators.push({
          edgeIndex: Math.floor(Math.random() * edges.length),
          progress: Math.random(),
          speed: 0.002 + Math.random() * 0.004,
          size: 2 + Math.random() * 3,
          opacity: 0.6 + Math.random() * 0.4,
        });
      }
    };

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      ctx.clearRect(0, 0, w, h);

      // Draw edges (web)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const edge of edges) {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();

      // Draw nodes (web intersections)
      ctx.fillStyle = 'rgba(239, 68, 68, 0.06)';
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Update and draw locators
      for (const loc of locators) {
        loc.progress += loc.speed;
        
        if (loc.progress >= 1) {
          // Move to a connected edge
          const currentEdge = edges[loc.edgeIndex];
          const endNode = Math.random() > 0.5 ? currentEdge.to : currentEdge.from;
          
          // Find edges connected to this node
          const connectedEdges = edges
            .map((e, idx) => ({ edge: e, idx }))
            .filter(({ edge, idx }) => 
              idx !== loc.edgeIndex && (edge.from === endNode || edge.to === endNode)
            );
          
          if (connectedEdges.length > 0) {
            const next = connectedEdges[Math.floor(Math.random() * connectedEdges.length)];
            loc.edgeIndex = next.idx;
            loc.progress = next.edge.from === endNode ? 0 : 1;
            loc.speed = Math.abs(loc.speed) * (next.edge.from === endNode ? 1 : -1);
          } else {
            loc.speed *= -1;
            loc.progress = 1;
          }
        } else if (loc.progress <= 0) {
          const currentEdge = edges[loc.edgeIndex];
          const endNode = Math.random() > 0.5 ? currentEdge.from : currentEdge.to;
          
          const connectedEdges = edges
            .map((e, idx) => ({ edge: e, idx }))
            .filter(({ edge, idx }) => 
              idx !== loc.edgeIndex && (edge.from === endNode || edge.to === endNode)
            );
          
          if (connectedEdges.length > 0) {
            const next = connectedEdges[Math.floor(Math.random() * connectedEdges.length)];
            loc.edgeIndex = next.idx;
            loc.progress = next.edge.to === endNode ? 1 : 0;
            loc.speed = Math.abs(loc.speed) * (next.edge.to === endNode ? -1 : 1);
          } else {
            loc.speed *= -1;
            loc.progress = 0;
          }
        }

        const edge = edges[loc.edgeIndex];
        if (!edge) continue;
        
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        const x = from.x + (to.x - from.x) * loc.progress;
        const y = from.y + (to.y - from.y) * loc.progress;

        // Glow effect
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, loc.size * 4);
        gradient.addColorStop(0, `rgba(239, 68, 68, ${loc.opacity * 0.8})`);
        gradient.addColorStop(0.5, `rgba(239, 68, 68, ${loc.opacity * 0.3})`);
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, loc.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = `rgba(255, 100, 100, ${loc.opacity})`;
        ctx.beginPath();
        ctx.arc(x, y, loc.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 -z-10 pointer-events-none"
    />
  );
}
