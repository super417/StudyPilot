"""Shared divergence threshold for dual-ring and reinforce triggers.

Must stay equal to ``DIVERGENCE_THRESHOLD`` in
``frontend/src/components/PhaseRings.tsx``. Call sites import this name;
do not inline the number.
"""

# Experience value, not a research finding. Adjustable.
DIVERGENCE_THRESHOLD = 30
