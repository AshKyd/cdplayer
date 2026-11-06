<script lang="ts">
  import { attributionParagraph } from "$lib/about/attributions";
  import { APP_NAME, APP_VERSION, BUILD_DATE } from "$lib/about/buildInfo";
</script>

<div class="about">
  <header class="identity">
    <img src="/cd.svg" alt="" width="72" height="72" />
    <div>
      <h2>{APP_NAME}</h2>
      <p class="muted">Version {APP_VERSION} · built {BUILD_DATE}</p>
    </div>
  </header>

  <section>
    <h3>Attributions</h3>
    <p class="muted">This software is made possible by the following packages: {attributionParagraph()}.</p>
  </section>
</div>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h3 {
    margin-bottom: 0.5rem;
  }
  .muted {
    color: var(--akui-fg-secondary);
  }
</style>
