"""UI setup flow: lets Glass Panes be added from Settings > Devices & services."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, NAME


class GlassPanesConfigFlow(ConfigFlow, domain=DOMAIN):
    """One confirm screen, no fields. `single_config_entry` in the manifest blocks a second copy."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the confirm screen, then create the entry when Submit is clicked."""
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")
