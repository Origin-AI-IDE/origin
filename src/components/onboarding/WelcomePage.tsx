import { useState, useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import onboardingImg from '../../assets/onboarding-image.png';
import wordmarkWhite from '../../assets/origin_wordmark_white_color.svg';
import wordmarkBlack from '../../assets/origin_wordmark_black_color.svg';
import { useTheme } from '../../themes/ThemeContext';

interface Props { onStart: () => void; onSkip: () => void; }

const SLIDES = [onboardingImg, onboardingImg, onboardingImg];

export default function WelcomePage({ onStart, onSkip }: Props) {
  const [slideIdx, setSlideIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { theme } = useTheme();

  function startInterval() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setSlideIdx(i => (i + 1) % SLIDES.length), 3500);
  }

  useEffect(() => { startInterval(); return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  function goTo(i: number) { setSlideIdx(i); startInterval(); }

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-hidden" style={{ padding: '28px 48px 32px', gap: 0 }}>

      {/* Hero */}
      <div className="flex flex-col items-center" style={{ gap: '12px', marginBottom: '20px' }}>
        <img src={theme.type === 'dark' ? wordmarkWhite : wordmarkBlack} alt="Origin" style={{ height: '42px' }} />
        <p style={{ fontSize: '21px', fontWeight: 600, color: 'var(--origin-fg-default)', letterSpacing: '-0.3px', textAlign: 'center', lineHeight: 1.3 }}>
          Open-source AI coding without lock-in.
        </p>
        <p style={{ fontSize: '14px', color: '#888', textAlign: 'center', lineHeight: 1.5, maxWidth: '460px' }}>
          Connect Claude, GPT, Gemini, OpenRouter, Ollama, or your own infrastructure.
        </p>
      </div>

      {/* Slideshow */}
      <div className="flex flex-col items-center" style={{ width: '100%', maxWidth: '780px', gap: '10px' }}>
        <div style={{ position: 'relative', width: '100%', height: '380px' }}>
          {SLIDES.map((src, i) => (
            <div key={i} style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: i === slideIdx ? 1 : 0, transition: 'opacity 0.65s ease', pointerEvents: 'none',
            }}>
              <img src={src} alt={`slide ${i + 1}`} style={{
                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                borderRadius: '4px', display: 'block',
              }} />
            </div>
          ))}
        </div>
        {/* Dots */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} style={{
              height: '5px', width: i === slideIdx ? '22px' : '6px',
              borderRadius: '3px', border: 'none', padding: 0, cursor: 'pointer',
              background: i === slideIdx ? 'var(--origin-fg-default)' : '#2a2a2a',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center" style={{ gap: '10px', marginTop: '18px' }}>
        <button
          onClick={onStart}
          style={{ background: 'var(--origin-tooltip-bg)', color: 'var(--origin-tooltip-fg)', border: 'none', borderRadius: '7px', padding: '10px 28px 10px 36px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.2px', display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'inherit', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.9'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          Get Started <ArrowRight size={18} />
        </button>
        <button
          onClick={onSkip}
          style={{ background: 'none', border: 'none', color: '#555', fontSize: '12px', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit', letterSpacing: '0.1px' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#888'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555'; }}
        >
          Skip setup
        </button>
      </div>

    </div>
  );
}
