#!/usr/bin/env python3
"""Hub API helper — returns circuit breaker status as JSON."""
import sys
sys.path.insert(0, "/home/trevor/trevor")

import json
from circuit_breaker import CircuitBreakerSystem

cb = CircuitBreakerSystem()
print(json.dumps(cb.get_status(), default=str))
