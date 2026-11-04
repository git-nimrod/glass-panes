"""Constants shared across the Glass Panes integration."""

from logging import Logger, getLogger

DOMAIN = "glass_panes"
NAME = "Glass Panes"

LOGGER: Logger = getLogger(__package__)

# Sent through Home Assistant's dispatcher so the select entities follow changes made from anywhere (services,
# the websocket API, the builder). The display id is the argument where there is one.
SIGNAL_DISPLAY_ADDED = f"{DOMAIN}_display_added"
SIGNAL_DISPLAY_UPDATED = f"{DOMAIN}_display_updated"
SIGNAL_DISPLAY_REMOVED = f"{DOMAIN}_display_removed"
SIGNAL_PANES_CHANGED = f"{DOMAIN}_panes_changed"

DEFAULT_PANE = "mirror"
