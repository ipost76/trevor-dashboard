'use client';

import React from 'react';

export function SkeletonPulse({
  width = '100%',
  height = '16px',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        background:
          'linear-gradient(90deg, rgba(0,255,136,0.03) 25%, rgba(0,255,136,0.08) 50%, rgba(0,255,136,0.03) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeletonShimmer 1.5s ease-in-out infinite',
        borderRadius: '4px',
      }}
    />
  );
}

export function SkeletonStatCard() {
  return (
    <div
      style={{
        padding: '16px',
        background: 'rgba(0,255,136,0.02)',
        border: '1px solid rgba(0,255,136,0.1)',
        borderRadius: '8px',
      }}
    >
      <SkeletonPulse width="60%" height="12px" />
      <div style={{ marginTop: '8px' }}>
        <SkeletonPulse width="80%" height="24px" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(0,255,136,0.06)',
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
      }}
    >
      <SkeletonPulse width="60px" height="14px" />
      <SkeletonPulse width="80px" height="14px" />
      <SkeletonPulse width="100px" height="14px" />
      <SkeletonPulse width="60px" height="14px" />
    </div>
  );
}

export function SkeletonWidget({
  rows = 5,
  title,
}: {
  rows?: number;
  title?: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(0,255,136,0.02)',
        border: '1px solid rgba(0,255,136,0.08)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(0,255,136,0.08)',
          }}
        >
          <SkeletonPulse width="120px" height="14px" />
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid rgba(0,255,136,0.04)',
          }}
        >
          <SkeletonPulse width={`${55 + (i * 7) % 35}%`} height="14px" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div
      style={{
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <SkeletonPulse width="200px" height="28px" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
        }}
      >
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <SkeletonWidget rows={8} title=" " />
    </div>
  );
}
