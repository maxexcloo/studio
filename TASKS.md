# Tasks

Checkboxes track implementation and relevant checks. Live activation is tracked below.

1. [x] Make generation completion a smaller notification that can be swiped away.
2. [x] Place mobile generation activity beside Gallery without occupying a separate box.
3. [x] Open mobile gallery search from a search button instead of keeping it above the gallery.
4. [x] Use dropdown boxes for gallery search filters.
5. [x] Make the mobile long-press menu compact.
6. [x] Make the new controls and features visually consistent with the existing UI.
7. [x] Put the mobile favourite star at the top and provide a direct Copy Prompt action.
8. [x] Fix the editor opening with a tiny image.
9. [x] Add general AI Control actions to chat: workload discovery, status, preview, explicit allocation changes and operation status. Use separate admin permissions and per-user credentials.
10. [x] Add an action for selected gallery photos that suggests editable motion prompts from their saved prompts and queues one MiniMax H3 video per photo. Preserve partial successes and prevent duplicate submissions on retry.
11. [x] Improve chat responsiveness and show short, readable tool names. Expose Models, Generate, Status, Result, Cancel, Upload and Reuse, with friendly titles where supported. Reference: https://chat.excloo.com/c/e4faf4fb-8f0e-4df3-b1a1-80c328eefd62.
12. [x] Keep image generation from blocking chat. Submission and status calls return immediately by default; retrieve results when requested.
13. [x] Refresh the LibreChat model list when models change in AI Control. LibreChat replaces OpenWebUI; bypass the shared model cache for Bento. Reload an open chat to request the updated list.
14. [x] Make AI Control usable on mobile.
15. [x] Support double-tap zoom in and out with native-feeling touch interaction.
16. [x] Make tapping generation activity return to the top.

Changes span `heiss-ui`, `../ai` and `../kubelab`. The linked private conversation could not be read through the web tool; its reported symptoms are covered above.

## UI Refinements

17. [x] Separate the right-side Select and Auto-Grouping buttons; show X Selected while selecting and centre action icons in their highlights.
18. [x] Animate bounded search expansion & collapse independently of Filters. Give search its own clear-and-close X and filters their own Clear action; dismiss empty search on outside clicks while retaining active queries.
19. [x] Label gallery selectors Images/Videos and creation selectors Image/Video.
20. [x] Rename Add Start Image to Reference Image.
21. [x] Make Image & Model Library visually consistent, repair failures and reduce repeated loading work.
22. [x] Remove side controls and put their options into a compact bottom creation box that expands on interaction.
23. [x] Open LoRAs in a reference-style popover & mobile sheet; keep a model dropdown and offer a full model-picker modal from creation controls.
24. [x] Remove the bottom-right model modal link.
25. [x] Rename Animate Photos to Animate; retain per-photo editable prompt and H3 model review before queueing, as confirmed.
26. [x] Grow prompt and negative prompt fields to a capped height without clipping, and provide independent recent negative prompts.
27. [x] Integrate MCP into the existing HEISS Node server, reusing its model, generation, upload & gallery APIs. Keep profiles in `../ai`; remove the separate Python service and source copy.
28. [x] Use consistent button sizes, surfaces, icon/text treatment and interaction animations.
29. [x] Slide Filters out inline like Select, using aligned compact dropdown icons without horizontal scrolling; give enabled Select a clear active affordance.
30. [x] Make the collapsed composer a muted single-line prompt with overflow ellipsis & Send only; expand on selection and collapse smoothly on outside clicks.
31. [x] Remove the main Zen entry point, retaining an exit for existing saved Zen views.
32. [x] Move Hidden access into the top gallery filters.
33. [x] Remove sample prompts, including automatic insertion after starter downloads.
34. [x] Keep Select expansion vertically stable with visible native scrollbars, split toolbar tools into separate pills and remove sideways scrolling from Filters.

35. [x] Make the compact composer more translucent, retaining only the muted prompt preview & Send.
36. [x] Start expanded prompt and negative prompt fields at two lines without headings, with independent Clear & History icons centred vertically on the right.
37. [x] Put references & LoRAs on the left of the resource row, the model picker on the right, and generation controls, Reset & Send on the bottom row; remove Collapse.
38. [x] Put Browse Models inside the desktop model dropdown and use the full model picker on mobile.
39. [x] Move Image & Model Library to the middle of the bottom-right dock.
40. [x] Keep multiple reference images available up to each model’s declared capacity.
41. [x] Keep LoRAs in the resource row and Advanced Settings in the bottom controls, opening consistent overlays.

42. [x] Hide Negative Prompt for unsupported profiles without deleting its draft.
43. [x] Verify model, Image/Video & privacy-space transitions, including references, per-mode settings, valid zero defaults and draft persistence.

44. [x] Remove Recent model UI & Find More Models, show detailed model information, match Browse Models to dropdown rows, and style + LoRAs & Advanced Settings consistently.

45. [x] Use No Outputs Yet consistently in gallery & reference-library empty states; audit visible gallery, search, Hidden & workflow-library empty headings and actions for Title Case while keeping explanatory prose in sentence case.

46. [x] Open + LoRAs in the same anchored popover & mobile sheet style as Reference Image, retaining model compatibility, selection & strength controls.

47. [x] Align Browse Models edges, text & icons with the model option rows.

48. [x] Keep the selected model tick without a persistent row highlight.
49. [x] Use a compact LoRA popover with a single list, direct selection & inline options instead of wide cards.

50. [x] Show Prompt... when the compact composer is empty on desktop & mobile.
51. [x] Bring Grouping into line with the other action buttons; align top & bottom secondary controls for default, selected, hover & focus states without changing Send.
52. [x] Match the focused Search border to the shared action shell and retain an inset keyboard focus indicator on desktop & mobile.
53. [x] Embed the existing researched prompting guidelines & patterns in all 45 maintained AI profiles and expose them through the model API & MCP. Prefer profile-owned guidance over the compatibility inventory.
54. [x] Preserve per-user MCP ownership, separate studio & AI Control credentials, non-blocking submission, revocable signed results and an explicit offline legacy-ownership importer.

## Delivery

- [x] Finish final browser checks and the required AI configuration check on Bento. Initial HEISS checks: 656 tests passed; browser checks: 108 passed with 10 intentional skips. Bento's isolated `mise run check --ci`: passed, including 234 Python tests. Production builds were reserved for verifying bundled UI changes.
- [x] Verify AI Control and Kubelab. AI Control: 8 UI tests passed. Kubelab `mise run check`: passed, including 92 Python tests and 502 valid resources with zero schema errors. Both affected Kustomize bases and pinned Helm charts rendered successfully.
- [ ] Deferred by user: provision the distinct AI Control MCP provider credential and grant an administrator's personal LiteLLM key access to `ai-control`. Ordinary chat credentials must remain unable to control GPUs.
- [x] Complete native MCP source ownership in `heiss-ui`, retire `../ai/media_mcp` and update the local AI & Kubelab consumers. Kubelab checks passed: 92 Python tests, 504 valid resources, zero schema errors; affected Kustomize configuration & the pinned LiteLLM Helm chart rendered successfully.
- [ ] Deferred by user: publish and deploy the reviewed changes, import legacy ownership explicitly if needed, then verify live integrations. No release, live credentials or deployment have been changed in this session.
- [x] Verify the UI refinements above after their final changes. `mise run check`: 671 passed; production build passed. Bundled browser suite: 143 passed & 20 intentional skips; its five failures were corrected and the final affected desktop/mobile checks passed 24/24. Local demo remains available for review; no deployment was performed.
- [x] Verify the final native MCP, profile guidance & control-state changes locally. HEISS `mise run check`: 707 tests passed, including 29 native integration & five importer tests. Final focused desktop/mobile browser checks: 36 passed & 12 intentional skips. AI Python suite: 200 passed & five platform skips. Diff whitespace checks passed in all three repositories. Local demo: http://127.0.0.1:5173/.
- [ ] Run the required final AI configuration check on Bento for the native MCP & profile changes. Automatic approval review rejected copying the private source to Bento; explicit approval is required. Earlier Bento checks above predate these changes.
