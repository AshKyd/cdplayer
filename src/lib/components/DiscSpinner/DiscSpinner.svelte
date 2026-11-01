<svg class="disc" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Reading disc">
  <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" />
  <circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2" />
  <!-- Off-centre arcs so the rotation is visible, like light catching a disc. -->
  <path d="M16 6 A10 10 0 0 1 26 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6" />
  <path d="M16 26 A10 10 0 0 1 6 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6" />
</svg>

<style>
  .disc {
    width: 2rem;
    height: 2rem;
    animation: spin 1.2s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .disc {
      animation: none;
    }
  }
</style>
