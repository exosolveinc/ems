// API Response Utility Functions

export function successResponse(data: any, message?: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      ...(message && { message })
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function errorResponse(error: string, status: number = 400, details?: any) {
  return new Response(
    JSON.stringify({
      success: false,
      error,
      ...(details && { details })
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function unauthorizedResponse(message: string = 'Unauthorized') {
  return errorResponse(message, 401);
}

export function notFoundResponse(message: string = 'Resource not found') {
  return errorResponse(message, 404);
}

export function serverErrorResponse(message: string = 'Internal server error') {
  return errorResponse(message, 500);
}
