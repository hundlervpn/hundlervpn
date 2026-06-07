'use client';

import { useEffect, useMemo, useState } from 'react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { ISourceOptions } from '@tsparticles/engine';

export default function SparkEffect() {
  const [init, setInit] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      setInit(true);
    });
  }, []);

  const options: ISourceOptions = useMemo(
    () => ({
      fullScreen: false,
      background: {
        color: { value: 'transparent' },
      },
      fpsLimit: 60,
      particles: {
        number: {
          value: 0,
        },
        color: {
          value: ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00', '#fff'],
        },
        shape: {
          type: 'circle',
        },
        opacity: {
          value: { min: 0.5, max: 1 },
          animation: {
            enable: true,
            speed: 2,
            startValue: 'max',
            destroy: 'min',
          },
        },
        size: {
          value: { min: 1, max: 4 },
          animation: {
            enable: true,
            speed: 3,
            startValue: 'max',
            destroy: 'min',
          },
        },
        move: {
          enable: true,
          speed: { min: 3, max: 8 },
          direction: 'none',
          random: true,
          straight: false,
          outModes: {
            default: 'destroy',
          },
          gravity: {
            enable: true,
            acceleration: 5,
          },
        },
        life: {
          duration: {
            sync: false,
            value: { min: 0.3, max: 0.8 },
          },
          count: 1,
        },
        twinkle: {
          particles: {
            enable: true,
            frequency: 0.5,
            opacity: 1,
          },
        },
      },
      emitters: {
        position: {
          x: 50,
          y: 50,
        },
        rate: {
          delay: 0.05,
          quantity: 2,
        },
        size: {
          width: 20,
          height: 20,
        },
        particles: {
          move: {
            speed: { min: 5, max: 15 },
            outModes: {
              default: 'destroy',
            },
          },
        },
      },
      detectRetina: true,
    }),
    []
  );

  if (!init) return null;

  return (
    <Particles
      id="sparks"
      options={options}
      className="absolute inset-0 pointer-events-none"
    />
  );
}
