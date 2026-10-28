"""Timestamp regressions using synthetic native fields; no SDK or network calls."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import mt5_demo_probe as probe
from mt5_running_probe_test import InspectionSdk, TERMINAL


UTC = timezone.utc
CAT = timezone(timedelta(hours=2))
BASE = datetime(2026, 10, 28, 12, 0, 0, 123000, tzinfo=UTC)
RAW_SECONDS = 1793188800
RAW_MILLISECONDS = 1793188800123


def native_tick(seconds=RAW_SECONDS, milliseconds=RAW_MILLISECONDS):
    return SimpleNamespace(time=seconds, time_msc=milliseconds)


class TimestampTests(unittest.TestCase):
    def stamped(self, tick=None, captured=BASE + timedelta(seconds=2)):
        quoted_at, evidence = probe._tick_timestamp(tick if tick is not None else native_tick())
        quote = dict(evidence)
        probe._stamp_quote_time(quote, quoted_at, captured)
        return quoted_at, quote

    def test_utc_seconds_and_milliseconds_keep_their_original_unix_instant(self):
        quoted_at, evidence = probe._tick_timestamp(native_tick())
        self.assertEqual(quoted_at, BASE)
        self.assertEqual(evidence["rawTime"], RAW_SECONDS)
        self.assertEqual(evidence["rawTimeMsc"], RAW_MILLISECONDS)
        self.assertTrue(evidence["rawFieldsConsistent"])
        self.assertEqual(evidence["secondsAsUtc"], "2026-10-28T12:00:00+00:00")
        self.assertEqual(evidence["millisecondsAsUtc"], BASE.isoformat())
        self.assertEqual(evidence["utcOffsetAppliedSeconds"], 0)

    def test_utc_plus_two_clock_is_the_same_instant_without_a_manual_offset(self):
        local = (BASE + timedelta(seconds=2)).astimezone(CAT)
        captured = probe._utc_time(lambda: local)
        self.assertEqual(captured, BASE + timedelta(seconds=2))
        self.assertEqual(captured.utcoffset(), timedelta(0))
        _, quote = self.stamped(captured=captured)
        self.assertEqual(quote["capturedAtUtc"], captured.isoformat())
        self.assertEqual(quote["ageSeconds"], 2.0)
        self.assertEqual(quote["utcOffsetAppliedSeconds"], 0)
        self.assertIsNone(quote["freshnessFailureCode"])

    def test_naive_clock_is_rejected_rather_than_labeled_utc(self):
        with self.assertRaises(probe.ProbeError) as caught:
            probe._utc_time(lambda: BASE.replace(tzinfo=None))
        self.assertEqual(caught.exception.code, "utc_clock_required")

    def test_millisecond_remainder_survives_conversion_and_raw_ages_agree(self):
        captured = BASE + timedelta(seconds=2)
        quoted_at, quote = self.stamped(captured=captured)
        self.assertEqual(quoted_at.microsecond, 123000)
        self.assertEqual(quote["ageSeconds"], 2.0)
        self.assertAlmostEqual(quote["ageSecondsFromRawTimeMsc"], 2.0, delta=0.000001)
        self.assertAlmostEqual(quote["ageSecondsFromRawTime"], 2.123, delta=0.000001)
        self.assertAlmostEqual(quote["captureUnixSeconds"], captured.timestamp(), delta=0.000001)

    def test_integer_millisecond_conversion_preserves_large_epoch_remainder(self):
        # Stay inside Windows' C-runtime date range while testing a Unix value
        # large enough for division through float to lose microsecond accuracy.
        quoted_at, evidence = probe._tick_timestamp(native_tick(32503679999, 32503679999999))
        self.assertEqual(quoted_at, datetime(2999, 12, 31, 23, 59, 59, 999000, tzinfo=UTC))
        self.assertTrue(evidence["rawFieldsConsistent"])
        self.assertEqual(evidence["utcOffsetAppliedSeconds"], 0)

    def test_missing_inconsistent_or_invalid_native_fields_never_fall_back(self):
        candidates = [
            None,
            SimpleNamespace(time=RAW_SECONDS),
            SimpleNamespace(time_msc=RAW_MILLISECONDS),
            native_tick(RAW_SECONDS + 1, RAW_MILLISECONDS),
        ]
        for field in ("time", "time_msc"):
            for invalid in (None, True, False, 0, -1, "1793188800", 1793188800.0):
                tick = native_tick()
                setattr(tick, field, invalid)
                candidates.append(tick)
        for tick in candidates:
            with self.subTest(tick=tick):
                quoted_at, evidence = probe._tick_timestamp(tick)
                self.assertIsNone(quoted_at)
                quote = dict(evidence)
                probe._stamp_quote_time(quote, quoted_at, BASE)
                self.assertIsNone(quote["ageSeconds"])
                self.assertEqual(quote["freshnessFailureCode"], "missing_or_inconsistent_native_timestamp")
                self.assertEqual(quote["utcOffsetAppliedSeconds"], 0)
                json.dumps(quote, allow_nan=False)

    def test_out_of_range_epoch_fails_safely_without_datetime_wrapping(self):
        for seconds in (253402300800, 10**30):
            with self.subTest(seconds=seconds):
                quoted_at, evidence = probe._tick_timestamp(native_tick(seconds, seconds * 1000 + 123))
                self.assertIsNone(quoted_at)
                quote = dict(evidence)
                probe._stamp_quote_time(quote, quoted_at, BASE)
                self.assertEqual(quote["freshnessFailureCode"], "missing_or_inconsistent_native_timestamp")
                json.dumps(quote, allow_nan=False)

    def test_seconds_supplied_as_milliseconds_are_not_automatically_rescaled(self):
        quoted_at, quote = self.stamped(native_tick(RAW_SECONDS, RAW_SECONDS))
        self.assertIsNone(quoted_at)
        self.assertFalse(quote["rawFieldsConsistent"])
        self.assertEqual(quote["rawTimeMsc"], RAW_SECONDS)
        self.assertEqual(quote["freshnessFailureCode"], "missing_or_inconsistent_native_timestamp")

    def test_genuine_two_hour_future_raw_time_keeps_negative_age_and_fails(self):
        quoted_at, quote = self.stamped(native_tick(RAW_SECONDS + 7200, RAW_MILLISECONDS + 7200000), captured=BASE)
        self.assertEqual(quoted_at, BASE + timedelta(hours=2))
        self.assertEqual(quote["ageSeconds"], -7200.0)
        self.assertAlmostEqual(quote["ageSecondsFromRawTimeMsc"], -7200.0, delta=0.000001)
        self.assertEqual(quote["utcOffsetAppliedSeconds"], 0)
        self.assertEqual(quote["freshnessFailureCode"], "quote_timestamp_in_future")

    def test_freshness_limits_remain_fifteen_seconds_and_five_future_seconds(self):
        for age, failure in ((15, None), (15.001, "quote_timestamp_stale"), (-5, None), (-5.001, "quote_timestamp_in_future")):
            with self.subTest(age=age):
                _, quote = self.stamped(captured=BASE + timedelta(seconds=age))
                self.assertEqual(quote["maximumAgeSeconds"], 15)
                self.assertEqual(quote["maximumFutureSeconds"], 5)
                self.assertEqual(quote["freshnessFailureCode"], failure)

    def test_mock_probe_with_utc_plus_two_clock_preserves_freshness(self):
        sdk = InspectionSdk()
        sdk.tick = SimpleNamespace(bid=1.1, ask=1.1001, time=RAW_SECONDS, time_msc=RAW_MILLISECONDS)
        captured = (BASE + timedelta(seconds=2)).astimezone(CAT)
        report = probe.inspect_running_demo(TERMINAL, "EURUSD", sdk, now=lambda: captured, running_terminal_checker=lambda path: path == TERMINAL)
        self.assertEqual(report["checks"]["quoteFresh"], "PASS")
        self.assertTrue(report["readOnlyProbeSucceeded"])
        self.assertEqual(report["quote"]["ageSeconds"], 2.0)
        self.assertEqual(report["quote"]["rawTime"], RAW_SECONDS)
        self.assertEqual(report["quote"]["rawTimeMsc"], RAW_MILLISECONDS)
        self.assertFalse(report["nativeDemoAccountVerified"])
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["actualBrokerOrderExecuted"])

    def test_mock_probe_genuine_future_tick_still_fails_under_utc_plus_two(self):
        sdk = InspectionSdk()
        sdk.tick = SimpleNamespace(bid=1.1, ask=1.1001, time=RAW_SECONDS + 7200, time_msc=RAW_MILLISECONDS + 7200000)
        report = probe.inspect_running_demo(TERMINAL, "EURUSD", sdk, now=lambda: BASE.astimezone(CAT), running_terminal_checker=lambda path: path == TERMINAL)
        self.assertEqual(report["checks"]["quoteFresh"], "FAIL")
        self.assertFalse(report["readOnlyProbeSucceeded"])
        self.assertEqual(report["quote"]["ageSeconds"], -7200.0)
        self.assertEqual(report["quote"]["freshnessFailureCode"], "quote_timestamp_in_future")
        self.assertTrue(report["sdkShutdownConfirmed"])
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["actualBrokerOrderExecuted"])


if __name__ == "__main__":
    unittest.main()
