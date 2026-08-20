"""_version_gt — gates AutoUpdater's decision to replace the running
binary. Getting this wrong either loops forever re-downloading the same
version or (worse) never updates."""

from conftest import agent


def test_simple_greater():
    assert agent._version_gt("1.6.0", "1.5.0")
    assert not agent._version_gt("1.5.0", "1.6.0")


def test_equal_versions_not_greater():
    assert not agent._version_gt("1.5.0", "1.5.0")


def test_different_length_versions():
    assert agent._version_gt("1.5.1", "1.5")
    assert not agent._version_gt("1.5", "1.5.1")
    assert agent._version_gt("2.0", "1.9.9")


def test_non_numeric_suffixes_are_ignored_not_fatal():
    # A version string like "1.5.0-beta" must not raise — non-digit
    # characters in a component are stripped, not rejected.
    assert agent._version_gt("1.6.0-beta", "1.5.0")


def test_double_digit_components_compare_numerically_not_lexically():
    # Lexical comparison would wrongly say "1.9" > "1.10".
    assert agent._version_gt("1.10.0", "1.9.0")
