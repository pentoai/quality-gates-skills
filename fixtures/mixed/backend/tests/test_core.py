from demo_api.core import greet


def test_greet_names_the_person() -> None:
    assert greet("Ada") == "Hello, Ada!"
