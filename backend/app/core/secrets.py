"""
Loads backend secrets from SSM Parameter Store when running on AWS Lambda.

Local development is unaffected: without the AWS_LAMBDA_FUNCTION_NAME variable
(which Lambda always sets), this is a no-op and configuration still comes from
`backend/.env`. On Lambda, the SecureString parameters under SSM_PATH_PREFIX are
decrypted and injected into the environment *before* Settings is constructed, so
the rest of the app behaves identically in both places.

Parameter naming: the suffix after the prefix becomes the env var / settings
field, e.g. `/promptpatrol/backend/JWT_SECRET` -> `JWT_SECRET` -> `jwt_secret`.
"""

import os

SSM_PATH_PREFIX = os.environ.get("SSM_PATH_PREFIX", "/promptpatrol/backend/")


def load_ssm_parameters_into_env() -> None:
    """On Lambda, pull SecureString params from SSM into os.environ. No-op locally."""
    if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return

    import boto3  # imported lazily so local dev never needs it

    ssm = boto3.client("ssm")
    paginator = ssm.get_paginator("get_parameters_by_path")
    for page in paginator.paginate(
        Path=SSM_PATH_PREFIX, WithDecryption=True, Recursive=True
    ):
        for param in page["Parameters"]:
            env_name = param["Name"].rsplit("/", 1)[-1]
            # setdefault: an explicitly-set Lambda env var still wins.
            os.environ.setdefault(env_name, param["Value"])
