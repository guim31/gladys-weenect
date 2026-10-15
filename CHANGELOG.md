# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Weenect GPS trackers in Gladys, from the e-mail and password of the Weenect
  account: one device per tracker with its position (text, accuracy, time of
  the last position), battery, low battery (threshold of the Weenect app),
  online state, status (online, offline, super live), "in a zone", current
  zone, and one presence feature per zone drawn in the Weenect app.
- Ring, vibrate and "ask for a position" buttons, usable from the dashboard and
  in scenes.
- Scene triggers "Weenect tracker enters a zone" and "leaves a zone", filtered
  by tracker and zone name, with the tracker name, the zone, the battery and a
  map link as variables.
- Scene action "Start Weenect super live", never started by the integration on
  its own.
- Dashboard widget "Weenect trackers": every tracker (zone, battery, last
  position, map link), or one tracker with its buttons.
- "Zones only" privacy mode: the coordinates never leave the container.
- "Test the connection" button in the configuration.
- English, French, German and Spanish, documentation included.
